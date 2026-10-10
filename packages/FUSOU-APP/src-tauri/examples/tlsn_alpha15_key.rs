use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use std::env;
use tlsn_attestation::signing::{Secp256k1Signer, Signer};

fn main() {
    for encoded_key in env::args().skip(1) {
        let key = hex::decode(encoded_key).expect("signing key must be hexadecimal");
        let signer = Secp256k1Signer::new(&key).expect("signing key must be valid secp256k1");
        let serialized = bincode::serialize(&signer.verifying_key()).expect("key must serialize");
        println!("{}", URL_SAFE_NO_PAD.encode(serialized));
    }
}