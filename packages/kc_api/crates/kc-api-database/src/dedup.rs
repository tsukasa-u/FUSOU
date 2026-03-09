use std::collections::HashMap;
use uuid::Uuid;

/// A cache for deduplicating records pushed to `PortTable`.
///
/// When the same source data (e.g. same `deck_id` or `base_id`) would produce
/// identical records across multiple battles or attacks, `DedupCache` remembers
/// the UUID assigned on the first insertion so subsequent calls can reuse it
/// instead of creating a duplicate row.
///
/// **Important**: This cache is purely key-based — it does **not** compare
/// record contents.  Only use it when the same key is guaranteed to map to the
/// same data within a single `PortTable::new` invocation.  Cases where the same
/// source ID can yield different data (e.g. before/after battle snapshots in
/// `schema_v0_5`) must **not** go through `DedupCache`.
#[derive(Debug, Default)]
pub struct DedupCache {
    caches: HashMap<&'static str, HashMap<i64, Uuid>>,
}

impl DedupCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the cached UUID for (`category`, `key`) if one exists, or call
    /// `create_fn(new_uuid)` to create the record.
    ///
    /// * If the key is already cached → returns `Some(existing_uuid)` without
    ///   calling `create_fn`.
    /// * If `create_fn` returns `Some(())` → the new UUID is cached and
    ///   `Some(new_uuid)` is returned.
    /// * If `create_fn` returns `None` → nothing is cached and `None` is
    ///   returned.
    pub fn get_or_insert_with<F>(
        &mut self,
        category: &'static str,
        key: i64,
        ts: uuid::Timestamp,
        create_fn: F,
    ) -> Option<Uuid>
    where
        F: FnOnce(Uuid) -> Option<()>,
    {
        if let Some(&existing) = self.caches.get(category).and_then(|m| m.get(&key)) {
            return Some(existing);
        }
        let uuid = Uuid::new_v7(ts);
        let result = create_fn(uuid);
        if result.is_some() {
            self.caches.entry(category).or_default().insert(key, uuid);
            Some(uuid)
        } else {
            None
        }
    }
}
