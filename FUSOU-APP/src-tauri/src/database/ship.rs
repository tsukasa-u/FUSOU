use apache_avro::{AvroSchema, Codec, Writer};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct OwnShip {
    pub id: i64,
    pub ship_id: Option<i64>,
    pub lv: Option<i64>,            // レベル
    pub nowhp: Option<i64>,         // 現在HP
    pub maxhp: Option<i64>,         // 最大HP
    pub soku: Option<i64>,          // 速力
    pub leng: Option<i64>,          // 射程
    pub slot: Option<Vec<i64>>,     // 装備
    pub onsolot: Option<Vec<i64>>,  // 艦載機搭載数
    pub slot_ex: Option<i64>,       // 補強増設
    pub fuel: Option<i64>,          // 燃料
    pub bull: Option<i64>,          // 弾薬
    pub cond: Option<i64>,          // 疲労度
    pub karyoku: Option<Vec<i64>>,  // 火力
    pub raisou: Option<Vec<i64>>,   // 雷装
    pub taiku: Option<Vec<i64>>,    // 対空
    pub soukou: Option<Vec<i64>>,   // 装甲
    pub kaihi: Option<Vec<i64>>,    // 回避
    pub taisen: Option<Vec<i64>>,   // 対潜
    pub sakuteki: Option<Vec<i64>>, // 索敵
    pub lucky: Option<Vec<i64>>,    // 運
    pub sally_area: Option<i64>,
    pub sp_effect_items: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct EnemyShip {
    pub id: i64,
    pub mst_ship_id: Option<i64>,
    pub lv: Option<i64>,           // レベル
    pub nowhp: Option<i64>,        // 現在HP
    pub maxhp: Option<i64>,        // 最大HP
    pub slot: Option<Vec<i64>>,    // 装備
    pub slotnum: Option<i64>,      // 装備スロット数
    pub karyoku: Option<Vec<i64>>, // 火力
    pub raisou: Option<Vec<i64>>,  // 雷装
    pub taiku: Option<Vec<i64>>,   // 対空
    pub soukou: Option<Vec<i64>>,  // 装甲
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct FriendShip {
    pub id: i64,
    pub mst_ship_id: Option<i64>,
    pub lv: Option<i64>,           // レベル
    pub nowhp: Option<i64>,        // 現在HP
    pub maxhp: Option<i64>,        // 最大HP
    pub slot: Option<Vec<i64>>,    // 装備
    pub slotnum: Option<i64>,      // 装備スロット数
    pub karyoku: Option<Vec<i64>>, // 火力
    pub raisou: Option<Vec<i64>>,  // 雷装
    pub taiku: Option<Vec<i64>>,   // 対空
    pub soukou: Option<Vec<i64>>,  // 装甲
}
