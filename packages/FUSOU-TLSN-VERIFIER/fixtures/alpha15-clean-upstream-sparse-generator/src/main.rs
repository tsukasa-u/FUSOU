use std::{env, fs, ops::Range};

use rand::{Rng, SeedableRng, rngs::StdRng};
use rangeset::set::RangeSet;
use tlsn_attestation::{
    Attestation, AttestationConfig, CryptoProvider,
    request::{Request, RequestConfig},
    signing::SignatureAlgId,
};
use tlsn_core::{
    connection::{CertBinding, CertBindingV1_2},
    fixtures::ConnectionFixture,
    hash::{Blake3, Blinder, HashAlgId},
    transcript::{
        Direction, Transcript, TranscriptCommitment, TranscriptSecret,
        hash::{PlaintextHash, PlaintextHashSecret, hash_plaintext},
    },
};
use tlsn_data_fixtures::http::{request::GET_WITH_HEADER, response::OK_JSON};

fn add_opening(
    transcript: &Transcript,
    direction: Direction,
    range: Range<usize>,
    rng: &mut StdRng,
    hasher: &Blake3,
    commitments: &mut Vec<TranscriptCommitment>,
    secrets: &mut Vec<TranscriptSecret>,
) {
    let idx = RangeSet::from(range.clone());
    let data = match direction {
        Direction::Sent => &transcript.sent()[range],
        Direction::Received => &transcript.received()[range],
    };
    let blinder: Blinder = rng.random();
    commitments.push(TranscriptCommitment::Hash(PlaintextHash {
        direction,
        idx: idx.clone(),
        hash: hash_plaintext(hasher, data, &blinder),
    }));
    secrets.push(TranscriptSecret::Hash(PlaintextHashSecret {
        direction,
        idx,
        alg: HashAlgId::BLAKE3,
        blinder,
    }));
}

fn main() {
    let output_path = env::args()
        .nth(1)
        .expect("provide an output Presentation path");
    let mut rng = StdRng::seed_from_u64(0);
    let mut provider = CryptoProvider::default();
    provider.signer.set_secp256k1(&[42u8; 32]).unwrap();

    let transcript = Transcript::new(GET_WITH_HEADER, OK_JSON);
    let sent_ranges = [0..3, 10..16];
    let received_ranges = [0..3, 137..145];
    let (sent_len, received_len) = transcript.len();
    let ConnectionFixture {
        server_name,
        connection_info,
        server_cert_data,
    } = ConnectionFixture::tlsnotary(transcript.length());
    let CertBinding::V1_2(CertBindingV1_2 {
        server_ephemeral_key,
        ..
    }) = server_cert_data.binding.clone()
    else {
        unreachable!()
    };

    let hasher = Blake3::default();
    let mut commitments = Vec::new();
    let mut secrets = Vec::new();
    for range in &sent_ranges {
        add_opening(
            &transcript,
            Direction::Sent,
            range.clone(),
            &mut rng,
            &hasher,
            &mut commitments,
            &mut secrets,
        );
    }
    for range in &received_ranges {
        add_opening(
            &transcript,
            Direction::Received,
            range.clone(),
            &mut rng,
            &hasher,
            &mut commitments,
            &mut secrets,
        );
    }

    let request_config = RequestConfig::default();
    let mut request_builder = Request::builder(&request_config);
    request_builder
        .server_name(server_name)
        .handshake_data(server_cert_data)
        .transcript(transcript)
        .transcript_commitments(secrets, commitments.clone());
    let (request, secrets) = request_builder.build(&provider).unwrap();

    let attestation_config = AttestationConfig::builder()
        .supported_signature_algs([SignatureAlgId::SECP256K1])
        .build()
        .unwrap();
    let mut attestation_builder = Attestation::builder(&attestation_config)
        .accept_request(request.clone())
        .unwrap();
    attestation_builder
        .connection_info(connection_info)
        .server_ephemeral_key(server_ephemeral_key)
        .transcript_commitments(commitments);
    let attestation = attestation_builder.build(&provider).unwrap();
    request.validate(&attestation, &provider).unwrap();

    let mut proof_builder = secrets.transcript_proof_builder();
    for range in &sent_ranges {
        proof_builder.reveal_sent(range.clone()).unwrap();
    }
    for range in &received_ranges {
        proof_builder.reveal_recv(range.clone()).unwrap();
    }
    let transcript_proof = proof_builder.build().unwrap();
    let mut presentation_builder = attestation.presentation_builder(&provider);
    presentation_builder
        .identity_proof(secrets.identity_proof())
        .transcript_proof(transcript_proof);
    let presentation = presentation_builder.build().unwrap();

    let verified = presentation
        .clone()
        .verify(&CryptoProvider::default())
        .unwrap();
    let partial_transcript = verified.transcript.unwrap();
    assert_eq!(partial_transcript.len_sent(), sent_len);
    assert_eq!(partial_transcript.len_received(), received_len);

    let presentation_bytes = bincode::serialize(&presentation).unwrap();
    let packed_transcript_bytes = bincode::serialize(&partial_transcript).unwrap();
    let notary_verifying_key = bincode::serialize(presentation.verifying_key()).unwrap();
    fs::write(&output_path, &presentation_bytes).unwrap();
    fs::write(
        format!("{output_path}.packed-transcript"),
        &packed_transcript_bytes,
    )
    .unwrap();
    fs::write(
        format!("{output_path}.notary-verifying-key"),
        &notary_verifying_key,
    )
    .unwrap();
    println!(
        "sent={sent_len}; received={received_len}; sent_ranges={:?}; received_ranges={:?}; presentation_bytes={}; packed_transcript_bytes={}; notary_verifying_key_bytes={}",
        sent_ranges,
        received_ranges,
        presentation_bytes.len(),
        packed_transcript_bytes.len(),
        notary_verifying_key.len()
    );
}
