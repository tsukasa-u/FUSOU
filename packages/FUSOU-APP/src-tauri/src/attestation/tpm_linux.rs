#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
pub(super) mod linux_impl {
    use rsa::{pkcs8::EncodePublicKey, BigUint, RsaPublicKey};
    use sha2::{Digest, Sha256};
    use std::convert::TryFrom;
    use std::env;
    use tss_esapi::{
        attributes::ObjectAttributesBuilder,
        handles::{KeyHandle, PersistentTpmHandle, TpmHandle},
        interface_types::{
            algorithm::{HashingAlgorithm, PublicAlgorithm, RsaSchemeAlgorithm},
            dynamic_handles::Persistent,
            key_bits::RsaKeyBits,
            resource_handles::{Hierarchy, Provision},
            session_handles::AuthSession,
        },
        structures::{
            Data, PcrSelectionListBuilder, PcrSlot, Public, PublicBuilder,
            PublicKeyRsa, PublicRsaParametersBuilder, RsaExponent, RsaScheme,
            Signature, SignatureScheme, SymmetricDefinitionObject,
        },
        traits::Marshall,
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
        let mut context = initialize_tpm_context()?;

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

        let quote_result = context.execute_with_session(
            Some(AuthSession::Password),
            |ctx| ctx.quote(key_handle, qualifying_data, SignatureScheme::Null, pcr_selection),
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
            match load_persistent_attestation_key(context, persistent_handle) {
                Ok(existing_key_handle) => {
                    if is_valid_attestation_key(context, existing_key_handle)? {
                        return Ok(existing_key_handle);
                    }

                    let mut object_handle = existing_key_handle.into();
                    let _ = context.tr_close(&mut object_handle);
                    tracing::warn!(
                        handle = format_args!("0x{:08X}", u32::from(persistent_handle)),
                        "Found invalid persistent TPM object; attempting in-place replacement"
                    );

                    match replace_persistent_attestation_key(context, persistent_handle) {
                        Ok(key_handle) => return Ok(key_handle),
                        Err(err) => tracing::warn!(
                            handle = format_args!("0x{:08X}", u32::from(persistent_handle)),
                            error = %err,
                            "Failed to replace invalid persistent TPM object"
                        ),
                    }
                }
                Err(_) => {}
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
        let object_attributes = ObjectAttributesBuilder::new()
            .with_restricted(true)
            .with_user_with_auth(true)
            .with_sign_encrypt(true)
            .with_decrypt(false)
            .with_fixed_tpm(true)
            .with_fixed_parent(true)
            .with_sensitive_data_origin(true)
            .build()
            .map_err(|err| format!("failed to build TPM object attributes: {err}"))?;

        PublicBuilder::new()
            .with_public_algorithm(PublicAlgorithm::Rsa)
            .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
            .with_object_attributes(object_attributes)
            .with_rsa_parameters(
                PublicRsaParametersBuilder::new()
                    .with_scheme(
                        RsaScheme::create(
                            RsaSchemeAlgorithm::RsaSsa,
                            Some(HashingAlgorithm::Sha256),
                        )
                        .map_err(|err| format!("failed to build RSA scheme: {err}"))?,
                    )
                    .with_key_bits(RsaKeyBits::Rsa2048)
                    .with_exponent(RsaExponent::default())
                    .with_is_signing_key(true)
                    .with_is_decryption_key(false)
                    .with_restricted(true)
                    .build()
                    .map_err(|err| format!("failed to build TPM RSA parameters: {err}"))?,
            )
            .with_rsa_unique_identifier(PublicKeyRsa::default())
            .build()
            .map_err(|err| format!("failed to build TPM attestation key template: {err}"))
    }

    fn replace_persistent_attestation_key(
        context: &mut Context,
        persistent_handle: PersistentTpmHandle,
    ) -> Result<KeyHandle, String> {
        let handle_value: u32 = persistent_handle.into();
        let mut existing_object_handle = context
            .execute_without_session(|ctx| {
                ctx.tr_from_tpm_public(TpmHandle::Persistent(persistent_handle))
            })
            .map_err(|err| {
                format!(
                    "failed to load persistent object for replacement at handle 0x{handle_value:08X}: {err}"
                )
            })?;

        let persistent = Persistent::Persistent(persistent_handle);
        let mut removed_object_handle = context
            .execute_with_session(Some(AuthSession::Password), |ctx| {
                ctx.evict_control(Provision::Owner, existing_object_handle.into(), persistent)
            })
            .map_err(|err| {
                format!(
                    "failed to evict invalid persistent object at handle 0x{handle_value:08X}: {err}"
                )
            })?;

        let _ = context.tr_close(&mut removed_object_handle);
        let _ = context.tr_close(&mut existing_object_handle);

        create_and_persist_attestation_key(context, persistent_handle)
    }

    fn is_valid_attestation_key(context: &mut Context, key_handle: KeyHandle) -> Result<bool, String> {
        let (public_area, _, _) = context
            .read_public(key_handle)
            .map_err(|err| format!("failed to inspect TPM attestation key public area: {err}"))?;

        let object_attributes = public_area.object_attributes();
        let is_valid_attributes = object_attributes.restricted()
            && object_attributes.sign_encrypt()
            && !object_attributes.decrypt();

        let is_valid_rsa_template = matches!(
            public_area,
            Public::Rsa { parameters, .. }
                if parameters.key_bits() == RsaKeyBits::Rsa2048
                    && parameters.rsa_scheme()
                        == RsaScheme::create(
                            RsaSchemeAlgorithm::RsaSsa,
                            Some(HashingAlgorithm::Sha256),
                        )
                        .map_err(|err| format!("failed to build RSA scheme for validation: {err}"))?
                    && parameters.symmetric_definition_object() == SymmetricDefinitionObject::Null
        );

        Ok(is_valid_attributes && is_valid_rsa_template)
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

        if let Some(raw) = crate::attestation::config_sync::resolve_tpm_persistent_handle_from_cached_config() {
            let handle_value = parse_persistent_handle_value(raw.trim())
                .map_err(|err| {
                    format!(
                        "invalid cached TPM persistent handle '{}': {}",
                        raw, err
                    )
                })?;
            let handle = PersistentTpmHandle::new(handle_value).map_err(|err| {
                format!(
                    "invalid cached TPM persistent handle 0x{handle_value:08X}: {err}"
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

    pub(crate) fn initialize_tpm_context_pub() -> Result<Context, String> {
        initialize_tpm_context()
    }

    fn initialize_tpm_context() -> Result<Context, String> {
        let mut candidate_errors = Vec::new();

        if let Some(env_candidate) = read_tcti_env_candidate() {
            match env_candidate.parse::<TctiNameConf>() {
                Ok(tcti) => match Context::new(tcti) {
                    Ok(context) => return Ok(context),
                    Err(err) => candidate_errors
                        .push(format!("env TCTI '{env_candidate}' failed: {err}")),
                },
                Err(err) => candidate_errors.push(format!(
                    "env TCTI '{env_candidate}' is invalid: {err}"
                )),
            }
        } else if let Ok(tcti) = TctiNameConf::from_environment_variable() {
            if let Ok(context) = Context::new(tcti) {
                return Ok(context);
            }
        }

        for candidate in DEFAULT_TCTI_CANDIDATES {
            let tcti = candidate.parse::<TctiNameConf>().map_err(|err| {
                format!("failed to parse TCTI candidate '{candidate}': {err}")
            })?;
            match Context::new(tcti) {
                Ok(context) => {
                    if !candidate_errors.is_empty() {
                        tracing::warn!(
                            previous_failures = %candidate_errors.join(" | "),
                            selected = candidate,
                            "TPM TCTI fallback selected after previous failures"
                        );
                    }
                    return Ok(context);
                }
                Err(err) => candidate_errors.push(format!("{candidate} failed: {err}")),
            }
        }

        Err(format!(
            "failed to initialize TPM context with all TCTI candidates: {}",
            candidate_errors.join(" | ")
        ))
    }

    fn read_tcti_env_candidate() -> Option<String> {
        env::var("TPM2TOOLS_TCTI")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| {
                env::var("TCTI")
                    .ok()
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            })
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

    pub(crate) fn tpm_rsa_public_to_spki_der_pub(public: &Public) -> Result<Vec<u8>, String> {
        tpm_rsa_public_to_spki_der(public)
    }

    /// Loads or creates the AK at the configured persistent handle.
    pub(crate) fn load_or_create_attestation_key_pub(
        context: &mut Context,
    ) -> Result<KeyHandle, String> {
        load_or_create_persistent_attestation_key(context)
    }

    /// Creates the standard RSA-2048 EK public template (TCG EK Credential Profile).
    pub(crate) fn create_ek_public_template() -> Public {
        let ek_policy_bytes: [u8; 32] = [
            0x83, 0x71, 0x97, 0x67, 0x44, 0x84, 0xB3, 0xF8,
            0x1A, 0x90, 0xCC, 0x8D, 0x46, 0xA5, 0xD7, 0x24,
            0xFD, 0x52, 0xD7, 0x6E, 0x06, 0x52, 0x0B, 0x64,
            0xF2, 0xA1, 0xDA, 0x1B, 0x33, 0x14, 0x69, 0xAA,
        ];
        let ek_policy = tss_esapi::structures::Digest::try_from(ek_policy_bytes.as_slice())
            .expect("EK policy digest");

        let ek_attrs = ObjectAttributesBuilder::new()
            .with_fixed_tpm(true)
            .with_fixed_parent(true)
            .with_sensitive_data_origin(true)
            .with_admin_with_policy(true)
            .with_restricted(true)
            .with_decrypt(true)
            .build()
            .expect("EK object attributes");

        PublicBuilder::new()
            .with_public_algorithm(PublicAlgorithm::Rsa)
            .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
            .with_object_attributes(ek_attrs)
            .with_auth_policy(ek_policy)
            .with_rsa_parameters(
                PublicRsaParametersBuilder::new()
                    .with_symmetric(SymmetricDefinitionObject::AES_128_CFB)
                    .with_scheme(
                        RsaScheme::create(RsaSchemeAlgorithm::Null, None)
                            .expect("EK RSA scheme"),
                    )
                    .with_key_bits(RsaKeyBits::Rsa2048)
                    .with_exponent(RsaExponent::default())
                    .with_is_decryption_key(true)
                    .with_is_signing_key(false)
                    .with_restricted(true)
                    .build()
                    .expect("EK RSA params"),
            )
            .with_rsa_unique_identifier(PublicKeyRsa::default())
            .build()
            .expect("EK public template")
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

#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
#[cfg(test)]
mod tests {
    use super::collect_tpm_attestation;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    #[test]
    fn linux_tpm_quote_executes_successfully() {
        let result = collect_tpm_attestation(b"fusou-linux-tpm-test");
        assert!(result.is_ok(), "TPM attestation should succeed: {result:?}");
    }

    /// Reads the EK (Endorsement Key) public key using the standard EK template,
    /// then attempts to fetch the EK certificate from AMD/Intel/manufacturer servers.
    /// Run: cargo test fetch_ek_certificate -- --nocapture --ignored
    #[ignore]
    #[test]
    fn fetch_ek_certificate() {
        use tss_esapi::{
            attributes::ObjectAttributesBuilder,
            interface_types::{
                algorithm::{HashingAlgorithm, PublicAlgorithm, RsaSchemeAlgorithm},
                key_bits::RsaKeyBits,
                resource_handles::Hierarchy,
            },
            structures::{
                Digest as TssDigest,
                PublicBuilder, PublicKeyRsa,
                PublicRsaParametersBuilder, RsaExponent, RsaScheme,
                SymmetricDefinitionObject,
            },
        };
        use super::linux_impl::initialize_tpm_context_pub;
        use base64::engine::general_purpose::STANDARD as B64;
        use base64::Engine;
        use sha2::{Digest as Sha2Digest, Sha256};

        let mut context = match super::linux_impl::initialize_tpm_context_pub() {
            Ok(c) => c,
            Err(e) => { println!("TPM context init failed: {e}"); return; }
        };

        // Standard RSA 2048 EK template (TCG EK Credential Profile spec)
        // PolicySecret(ENDORSEMENT) SHA-256 digest: the standard well-known EK policy
        let ek_policy_bytes: [u8; 32] = [
            0x83, 0x71, 0x97, 0x67, 0x44, 0x84, 0xB3, 0xF8,
            0x1A, 0x90, 0xCC, 0x8D, 0x46, 0xA5, 0xD7, 0x24,
            0xFD, 0x52, 0xD7, 0x6E, 0x06, 0x52, 0x0B, 0x64,
            0xF2, 0xA1, 0xDA, 0x1B, 0x33, 0x14, 0x69, 0xAA,
        ];
        let ek_policy = TssDigest::try_from(ek_policy_bytes.as_slice()).expect("EK policy digest");

        let ek_object_attributes = ObjectAttributesBuilder::new()
            .with_fixed_tpm(true)
            .with_fixed_parent(true)
            .with_sensitive_data_origin(true)
            .with_admin_with_policy(true)
            .with_restricted(true)
            .with_decrypt(true)
            .build()
            .expect("EK object attributes");

        let ek_public = PublicBuilder::new()
            .with_public_algorithm(PublicAlgorithm::Rsa)
            .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
            .with_object_attributes(ek_object_attributes)
            .with_auth_policy(ek_policy)
            .with_rsa_parameters(
                PublicRsaParametersBuilder::new()
                    .with_symmetric(SymmetricDefinitionObject::AES_128_CFB)
                    .with_scheme(
                        RsaScheme::create(RsaSchemeAlgorithm::Null, None)
                            .expect("EK RSA scheme"),
                    )
                    .with_key_bits(RsaKeyBits::Rsa2048)
                    .with_exponent(RsaExponent::default())
                    .with_is_decryption_key(true)
                    .with_is_signing_key(false)
                    .with_restricted(true)
                    .build()
                    .expect("EK RSA parameters"),
            )
            .with_rsa_unique_identifier(PublicKeyRsa::default())
            .build()
            .expect("EK public template");

        // CreatePrimary with EK template (endorsement hierarchy)
        let ek_result = context.execute_with_nullauth_session(|ctx| {
            ctx.create_primary(Hierarchy::Endorsement, ek_public, None, None, None, None)
        });

        match ek_result {
            Ok(created) => {
                let (ek_pub, _, _) = context.read_public(created.key_handle)
                    .expect("read EK public");
                let _ = context.flush_context(created.key_handle.into());

                // Extract RSA modulus
                let ek_der = super::linux_impl::tpm_rsa_public_to_spki_der_pub(&ek_pub).expect("EK DER");
                let ek_b64 = B64.encode(&ek_der);
                println!("\nEK public key (SPKI DER base64):\n{ek_b64}");

                // SHA-256 hash of EK modulus (used as identifier for cert lookup)
                let ek_sha256 = Sha256::digest(&ek_der);
                let ek_hex = hex::encode(ek_sha256);
                println!("EK SHA-256: {ek_hex}");

                // Try AMD cert provisioning endpoint
                // AMD fTPM EK certs may be at: https://ftpm.amd.com/pki/aia/
                let ek_b64_url = ek_b64.replace('+', "-").replace('/', "_").replace('=', "");
                println!("\nAMD cert lookup URL (if supported):");
                println!("https://ftpm.amd.com/pki/aia/{ek_b64_url}.cer");
                println!("\nAlternative: use tpm2_getekcertificate tool (requires tpm2-tools)");
                println!("  tpm2_getekcertificate -u ek.pub.pem -o ek.cert.pem");
            }
            Err(e) => println!("EK creation failed: {e}"),
        }
    }

    fn tpm_rsa_public_to_spki_der_pub(public: &tss_esapi::structures::Public) -> Result<Vec<u8>, String> {
        super::linux_impl::tpm_rsa_public_to_spki_der_pub(public)
    }

    #[ignore]
    #[test]
    fn read_manufacturer_ek_certs() {
        use tss_esapi::{
            handles::NvIndexTpmHandle,
            interface_types::resource_handles::NvAuth,
        };
        use base64::engine::general_purpose::STANDARD as B64;

        // Standard TPM 2.0 EK/IAK NV indices (TCG spec)
        let nv_candidates: &[(u32, &str)] = &[
            (0x01C00002, "RSA-2048 EK cert"),
            (0x01C00004, "RSA-2048 EK cert (intermediate)"),
            (0x01C00012, "RSA-2048 EK cert (backup)"),
            (0x01C0000A, "ECC P-256 EK cert"),
            (0x01C0000C, "ECC P-256 EK cert (intermediate)"),
            (0x01C0001C, "RSA-3072 EK cert"),
            (0x01C101D0, "DevID cert (IEEE 802.1AR)"),
            (0x01C10140, "IAK cert"),
        ];

        let mut context = match super::linux_impl::initialize_tpm_context_pub() {
            Ok(c) => c,
            Err(e) => { println!("TPM context init failed: {e}"); return; }
        };

        println!("\n=== TPM NV EK Certificate Scan ===");
        let mut found_any = false;
        for &(index, label) in nv_candidates {
            let nv_tpm_handle = NvIndexTpmHandle::new(index).unwrap();
            let nv_handle = match context.tr_from_tpm_public(nv_tpm_handle.into()) {
                Ok(h) => tss_esapi::handles::NvIndexHandle::from(h),
                Err(_) => continue, // NV index doesn't exist
            };
            if let Ok((nv_public, _)) = context.nv_read_public(nv_handle) {
                let size = nv_public.data_size();
                println!("  0x{index:08X} ({label}): found, size={size} bytes");
                match context.nv_read(NvAuth::Owner, nv_handle, size as u16, 0) {
                    Ok(data) => {
                        let b64_cert = B64.encode(data.as_slice());
                        println!("  CERT_B64={b64_cert}");
                        found_any = true;
                    }
                    Err(e) => println!("    cannot read: {e}"),
                }
            }
        }
        if !found_any {
            println!("  No manufacturer EK certs found in standard NV indices.");
            println!("  This TPM may not have manufacturer-provisioned EK certs.");
        }
    }
    #[ignore]
    #[test]
    fn export_tpm_attestation_json() {
        use base64::engine::general_purpose::STANDARD as B64;
        use base64::Engine;

        let nonce = "test-e2e-nonce";
        let result = collect_tpm_attestation(nonce.as_bytes());
        let (attest, sig, pub_key) = result.expect("TPM attestation must succeed");

        let json = serde_json::json!({
            "quote_b64": B64.encode(&attest),
            "sig_b64": B64.encode(&sig),
            "pub_key_b64": B64.encode(&pub_key),
            "nonce": nonce,
        });
        // Write to tmp file for E2E test
        let path = "/tmp/tpm_quote_e2e.json";
        std::fs::write(path, json.to_string()).expect("failed to write tpm quote");
        println!("\nTPM quote data written to {path}");
        println!("pub_key_b64={}", B64.encode(&pub_key));
    }
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
