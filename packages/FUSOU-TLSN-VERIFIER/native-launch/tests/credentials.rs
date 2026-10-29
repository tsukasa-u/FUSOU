use super::*;
#[test]
fn each_credential_failure_stops_before_exec_eligibility() {
    for failed in CREDENTIAL_STEPS {
        let mut observed = Vec::new();
        let exec_eligible = credential_sequence(|step| {
            observed.push(step);
            step != failed
        });
        assert!(!exec_eligible);
        assert_eq!(observed.last(), Some(&failed));
        assert_eq!(observed, CREDENTIAL_STEPS[..observed.len()]);
    }
    let mut observed = Vec::new();
    assert!(credential_sequence(|step| {
        observed.push(step);
        true
    }));
    assert_eq!(observed, CREDENTIAL_STEPS);
}
#[test]
fn saved_and_filesystem_identity_must_match_dedicated_ids() {
    let credentials = Credentials {
        uid: 12345,
        gid: 23456,
    };
    let ids = [12345, 12345, 12345, 23456, 23456, 23456];
    assert!(credential_ids_match(credentials, ids, 12345, 23456));
    for index in 0..6 {
        let mut wrong = ids;
        wrong[index] = 0;
        assert!(!credential_ids_match(credentials, wrong, 12345, 23456));
    }
    for (fsuid, fsgid) in [(0, 23456), (12345, 0), (-1, 23456), (12345, -1)] {
        assert!(!credential_ids_match(credentials, ids, fsuid, fsgid));
    }
}
