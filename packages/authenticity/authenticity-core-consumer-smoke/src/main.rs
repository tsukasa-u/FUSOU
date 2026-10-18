#![forbid(unsafe_code)]

fn main() {}

#[cfg(test)]
mod tests {
    use authenticity_core::{
        is_valid_key_id, AuthorityKeyId, ChallengeId, DeviceId, Digest, IdentityError, PrincipalId,
        ServerIdentity, SessionId, VerificationStatus,
    };

    #[test]
    fn public_api_works_from_an_independent_consumer() {
        let principal = PrincipalId::new("https://issuer.example", "player-7").unwrap();
        assert_eq!(principal.issuer(), "https://issuer.example");
        assert_eq!(principal.subject(), "player-7");

        let device = DeviceId::new("device-7").unwrap();
        let session = SessionId::new("session-7").unwrap();
        let authority_key = AuthorityKeyId::new("result-signer_2026.v1").unwrap();
        assert_eq!(device.as_str(), "device-7");
        assert_eq!(session.as_str(), "session-7");
        assert_eq!(authority_key.as_str(), "result-signer_2026.v1");

        let server = ServerIdentity::new("game.example").unwrap();
        assert_eq!(server.as_str(), "game.example");
        assert_eq!(
            ServerIdentity::new("Game.example").unwrap_err(),
            IdentityError::InvalidServerIdentity
        );

        assert!(is_valid_key_id("AZaz09._-"));
        assert!(!is_valid_key_id("key/id"));
        assert_eq!(
            DeviceId::new("device\n7").unwrap_err(),
            IdentityError::InvalidIdentifier
        );

        let challenge = ChallengeId::new([7; 16]);
        let digest = Digest::new([9; 32]);
        assert_eq!(challenge.as_bytes(), &[7; 16]);
        assert_eq!(digest.as_bytes(), &[9; 32]);

        assert_ne!(VerificationStatus::Verified, VerificationStatus::NotChecked);
    }
}
