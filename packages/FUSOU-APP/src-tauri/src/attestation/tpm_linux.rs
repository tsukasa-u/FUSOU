#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
mod linux_impl {
    use rsa::{pkcs8::EncodePublicKey, BigUint, RsaPublicKey};
    use sha2::{Digest, Sha256};
    use std::convert::TryFrom;
    use tss_esapi::{
        handles::{KeyHandle, PersistentTpmHandle, TpmHandle},
        interface_types::{
            algorithm::{HashingAlgorithm, RsaSchemeAlgorithm},
            dynamic_handles::Persistent,
            key_bits::RsaKeyBits,
            resource_handles::{Hierarchy, Provision},
            session_handles::AuthSession,
        },
        structures::{
            Data, PcrSelectionListBuilder, PcrSlot, Public, RsaExponent, RsaScheme, Signature,
            SignatureScheme,
        },
        traits::Marshall,
        utils::create_unrestricted_signing_rsa_public,
        Context, TctiNameConf,
    };

    const DEFAULT_RSA_EXPONENT: u32 = 65_537;
    const DEFAULT_TCTI_CANDIDATES: [&str; 2] = ["device:/dev/tpmrm0", "device:/dev/tpm0"];
    const AK_PERSISTENT_HANDLE_ENV: &str = "FUSOU_TPM_AK_PERSISTENT_HANDLE";
    const DEFAULT_AK_PERSISTENT_HANDLES: [u32; 8] = [
        0x8101_F500,
        0x8101_F501,
        0x8101_F502,
        0x8101_F503,
        0x8101_F504,
        0x8101_F505,
        0x8101_F506,
        0x8101_F507,
    ];

    pub fn collect_tpm_attestation(nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
        let tcti = resolve_tcti()?;
        let mut context =
            Context::new(tcti).map_err(|err| format!("failed to initialize TPM context: {err}"))?;

        let key_handle = load_or_create_persistent_attestation_key(&mut context)?;
        let (public_area, _, _) = context
            .read_public(key_handle)
            .map_err(|err| format!("failed to read TPM attestation key public area: {err}"))?;
        let public_key_der = tpm_rsa_public_to_spki_der(&public_area)?;
        let qualifying_data = build_qualifying_data(nonce)?;

        let pcr_selection = PcrSelectionListBuilder::new()
            .with_selection(
                HashingAlgorithm::Sha256,
                &[PcrSlot::Slot0, PcrSlot::Slot2, PcrSlot::Slot4, PcrSlot::Slot7],
            )
            .build()
            .map_err(|err| format!("failed to build PCR selection: {err}"))?;

        let quote_result = context.quote(
            key_handle,
            qualifying_data,
            SignatureScheme::Null,
            pcr_selection,
        );

        let mut key_object_handle = key_handle.into();
        let _ = context.tr_close(&mut key_object_handle);

        let (quote_attest, quote_signature) =
            quote_result.map_err(|err| format!("failed to execute TPM quote: {err}"))?;

        let quote_bytes = quote_attest
            .marshall()
            .map_err(|err| format!("failed to marshal TPM quote: {err}"))?;
        let signature_bytes = extract_quote_signature_bytes(quote_signature)?;

        Ok((quote_bytes, signature_bytes, public_key_der))
    }

    fn load_or_create_persistent_attestation_key(context: &mut Context) -> Result<KeyHandle, String> {
        let persistent_handles = resolve_persistent_ak_handles()?;

        for &persistent_handle in &persistent_handles {
            if let Ok(existing_key_handle) = load_persistent_attestation_key(context, persistent_handle) {
                return Ok(existing_key_handle);
            }
        }

        let mut creation_errors = Vec::new();
        for persistent_handle in persistent_handles {
            match create_and_persist_attestation_key(context, persistent_handle) {
                Ok(key_handle) => return Ok(key_handle),
                Err(err) => creation_errors.push(err),
            }
        }

        Err(format!(
            "failed to load/create persistent TPM attestation key from all configured handles: {}",
            creation_errors.join(" | ")
        ))
    }

    fn create_and_persist_attestation_key(
        context: &mut Context,
        persistent_handle: PersistentTpmHandle,
    ) -> Result<KeyHandle, String> {
        let signing_key_public = create_signing_key_public_template()?;

        let created_key = context
            .execute_with_nullauth_session(|ctx| {
                ctx.create_primary(
                    Hierarchy::Owner,
                    signing_key_public,
                    None,
                    None,
                    None,
                    None,
                )
            })
            .map_err(|err| format!("failed to create TPM attestation key: {err}"))?;

        let transient_key_handle = created_key.key_handle;
        let persistent = Persistent::Persistent(persistent_handle);
        let handle_value: u32 = persistent_handle.into();

        let mut persisted_object_handle = match context.execute_with_session(
            Some(AuthSession::Password),
            |ctx| ctx.evict_control(Provision::Owner, transient_key_handle.into(), persistent),
        ) {
            Ok(object_handle) => object_handle,
            Err(err) => {
                let _ = context.flush_context(transient_key_handle.into());
                return Err(format!(
                    "failed to persist TPM attestation key at handle 0x{handle_value:08X}: {err}"
                ));
            }
        };

        let _ = context.flush_context(transient_key_handle.into());
        let _ = context.tr_close(&mut persisted_object_handle);

        load_persistent_attestation_key(context, persistent_handle)
    }

    fn create_signing_key_public_template() -> Result<Public, String> {
        create_unrestricted_signing_rsa_public(
            RsaScheme::create(RsaSchemeAlgorithm::RsaSsa, Some(HashingAlgorithm::Sha256))
                .map_err(|err| format!("failed to build RSA scheme: {err}"))?,
            RsaKeyBits::Rsa2048,
            RsaExponent::default(),
        )
        .map_err(|err| format!("failed to build TPM key template: {err}"))
    }

    fn load_persistent_attestation_key(
        context: &mut Context,
        persistent_handle: PersistentTpmHandle,
    ) -> Result<KeyHandle, String> {
        let handle_value: u32 = persistent_handle.into();
        let object_handle = context
            .execute_without_session(|ctx| {
                ctx.tr_from_tpm_public(TpmHandle::Persistent(persistent_handle))
            })
            .map_err(|err| {
                format!(
                    "failed to load persistent TPM attestation key 0x{handle_value:08X}: {err}"
                )
            })?;

        Ok(object_handle.into())
    }

    fn resolve_persistent_ak_handles() -> Result<Vec<PersistentTpmHandle>, String> {
        if let Ok(raw) = std::env::var(AK_PERSISTENT_HANDLE_ENV) {
            let handle_value = parse_persistent_handle_value(raw.trim())?;
            let handle = PersistentTpmHandle::new(handle_value).map_err(|err| {
                format!(
                    "invalid TPM persistent handle 0x{handle_value:08X} (set {AK_PERSISTENT_HANDLE_ENV} to a valid value): {err}"
                )
            })?;
            return Ok(vec![handle]);
        }

        DEFAULT_AK_PERSISTENT_HANDLES
            .iter()
            .copied()
            .map(|handle_value| {
                PersistentTpmHandle::new(handle_value).map_err(|err| {
                    format!(
                        "invalid built-in TPM persistent handle 0x{handle_value:08X}: {err}"
                    )
                })
            })
            .collect()
    }

    fn parse_persistent_handle_value(value: &str) -> Result<u32, String> {
        if value.is_empty() {
            return Err(format!("{AK_PERSISTENT_HANDLE_ENV} is set but empty"));
        }

        if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
            return u32::from_str_radix(hex, 16).map_err(|err| {
                format!(
                    "failed to parse {AK_PERSISTENT_HANDLE_ENV} as hexadecimal handle: {err}"
                )
            });
        }

        value.parse::<u32>().map_err(|err| {
            format!(
                "failed to parse {AK_PERSISTENT_HANDLE_ENV} as decimal handle: {err}"
            )
        })
    }

    fn resolve_tcti() -> Result<TctiNameConf, String> {
        if let Ok(tcti) = TctiNameConf::from_environment_variable() {
            return Ok(tcti);
        }

        for candidate in DEFAULT_TCTI_CANDIDATES {
            if let Ok(tcti) = candidate.parse::<TctiNameConf>() {
                return Ok(tcti);
            }
        }

        Err(
            "failed to resolve TPM TCTI (set TPM2TOOLS_TCTI/TCTI or provide /dev/tpmrm0)"
                .to_string(),
        )
    }

    fn build_qualifying_data(nonce: &[u8]) -> Result<Data, String> {
        let nonce_digest = Sha256::digest(nonce);
        Data::try_from(nonce_digest.as_slice())
            .map_err(|err| format!("failed to build qualifying data: {err}"))
    }

    fn extract_quote_signature_bytes(signature: Signature) -> Result<Vec<u8>, String> {
        match signature {
            Signature::RsaSsa(rsa_signature) | Signature::RsaPss(rsa_signature) => {
                Ok(rsa_signature.signature().value().to_vec())
            }
            other => Err(format!(
                "unsupported TPM quote signature algorithm: {:?}",
                other.algorithm()
            )),
        }
    }

    fn tpm_rsa_public_to_spki_der(public: &Public) -> Result<Vec<u8>, String> {
        let (parameters, unique) = match public {
            Public::Rsa {
                parameters, unique, ..
            } => (parameters, unique),
            _ => {
                return Err("TPM key is not an RSA key".to_string());
            }
        };

        let modulus = BigUint::from_bytes_be(unique.value());
        let exponent_value = match parameters.exponent().value() {
            0 => DEFAULT_RSA_EXPONENT,
            value => value,
        };
        let exponent = BigUint::from(exponent_value);

        let rsa_public = RsaPublicKey::new(modulus, exponent)
            .map_err(|err| format!("failed to create RSA public key: {err}"))?;
        let der = rsa_public
            .to_public_key_der()
            .map_err(|err| format!("failed to encode public key in SPKI: {err}"))?;

        Ok(der.as_ref().to_vec())
    }
}

#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
pub fn collect_tpm_attestation(nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    linux_impl::collect_tpm_attestation(nonce)
}

#[cfg(all(target_os = "linux", not(feature = "linux-tpm-attestation")))]
pub fn collect_tpm_attestation(_nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    Err(
        "tpm attestation is disabled at compile time (enable feature 'linux-tpm-attestation')"
            .to_string(),
    )
}

#[cfg(not(target_os = "linux"))]
pub fn collect_tpm_attestation(_nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    Err("unsupported platform".to_string())
}
