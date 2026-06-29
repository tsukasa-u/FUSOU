#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
mod linux_impl {
    use rsa::{pkcs8::EncodePublicKey, BigUint, RsaPublicKey};
    use sha2::{Digest, Sha256};
    use std::convert::TryFrom;
    use tss_esapi::{
        interface_types::{
            algorithm::{HashingAlgorithm, RsaSchemeAlgorithm},
            key_bits::RsaKeyBits,
            resource_handles::Hierarchy,
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

    pub fn collect_tpm_attestation(nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
        let tcti = resolve_tcti()?;
        let mut context =
            Context::new(tcti).map_err(|err| format!("failed to initialize TPM context: {err}"))?;

        let signing_key_public = create_unrestricted_signing_rsa_public(
            RsaScheme::create(RsaSchemeAlgorithm::RsaSsa, Some(HashingAlgorithm::Sha256))
                .map_err(|err| format!("failed to build RSA scheme: {err}"))?,
            RsaKeyBits::Rsa2048,
            RsaExponent::default(),
        )
        .map_err(|err| format!("failed to build TPM key template: {err}"))?;

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

        let key_handle = created_key.key_handle;
        let public_key_der = tpm_rsa_public_to_spki_der(&created_key.out_public)?;
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

        let _ = context.flush_context(key_handle.into());

        let (quote_attest, quote_signature) =
            quote_result.map_err(|err| format!("failed to execute TPM quote: {err}"))?;

        let quote_bytes = quote_attest
            .marshall()
            .map_err(|err| format!("failed to marshal TPM quote: {err}"))?;
        let signature_bytes = extract_quote_signature_bytes(quote_signature)?;

        Ok((quote_bytes, signature_bytes, public_key_der))
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
