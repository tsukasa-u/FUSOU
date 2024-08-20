package main

// addtional refarence
// https://gist.github.com/eul721/84c3f78caa6fff3354fa

// api_get_member/deck
// api_get_member/kdock
// api_get_member/mapinfo
// api_get_member/material
// api_get_member/mission
// api_get_member/ndock
// api_get_member/payitem
// api_get_member/picture_book
// api_get_member/practice
// api_get_member/preset_deck
// api_get_member/questlist
// api_get_member/record
// api_get_member/require_info
// api_get_member/ship2
// api_get_member/ship3
// api_get_menber/ship_deck
// api_get_member/slot_item
// api_get_member/unsetslot
// api_get_member/useitem
// api_port/port
// api_req_battle_midnight/battle
// api_req_furniture/buy
// api_req_furniture/change
// api_req_hensei/change
// api_req_hensei/preset_delete
// api_req_hensei/preset_select
// api_req_hensei/preset_register
// api_req_hokyu/charge
// api_req_kaisou/can_preset_slot_select
// api_req_kaisou/lock
// api_req_kaisou/powerup
// api_req_kaisou/slotset
// api_req_kaisou/slot_deprive
// api_req_kaisou/remodeling
// api_req_kaisou/unsetslot_all
// api_req_kousyou/createitem
// api_req_kousyou/remodel_slotlist
// api_req_kousyou/createship
// api_req_kousyou/createship_speedchange
// api_req_kousyou/destroyitem2
// api_req_kousyou/destroyship
// api_req_kousyou/getship
// api_req_kousyou/remodel_slot
// api_req_map/next
// api_req_map/start
// api_req_mission/result
// api_req_mission/start
// api_req_member/get_practice_enemyinfo
// api_req_member/itemuse
// api_req_member/itemuse_cond
// api_req_member/get_incentive
// api_req_member/set_oss_condition
// api_req_member/updatecomment
// api_req_member/updatedeckname
// api_req_nyukyo/start
// api_req_practice/battle
// api_req_practice/battle_result
// api_req_practice/midnight_battle
// api_req_quest/clearitemget
// api_req_quest/start
// api_req_ranking/******
// api_req_sortie/battle
// api_req_sortie/battleresult
// api_req_sortie/ld_airbattle
// api_start2/getData

//api_port/port
type api_port__port struct {
	APIMaterial []struct {
		APIMemberID int `json:"api_member_id"`
		APIID       int `json:"api_id"`
		APIValue    int `json:"api_value"`
	} `json:"api_material"`
	APIDeckPort []struct {
		APIMemberID int    `json:"api_member_id"`
		APIID       int    `json:"api_id"`
		APIName     string `json:"api_name"`
		APINameID   string `json:"api_name_id"`
		APIMission  []int  `json:"api_mission"`
		APIFlagship string `json:"api_flagship"`
		APIShip     []int  `json:"api_ship"`
	} `json:"api_deck_port"`
	APINdock []struct {
		APIMemberID        int    `json:"api_member_id"`
		APIID              int    `json:"api_id"`
		APIState           int    `json:"api_state"`
		APIShipID          int    `json:"api_ship_id"`
		APICompleteTime    int64  `json:"api_complete_time"`
		APICompleteTimeStr string `json:"api_complete_time_str"`
		APIItem1           int    `json:"api_item1"`
		APIItem2           int    `json:"api_item2"`
		APIItem3           int    `json:"api_item3"`
		APIItem4           int    `json:"api_item4"`
	} `json:"api_ndock"`
	APIShip []struct {
		APIID            int   `json:"api_id"`
		APISortno        int   `json:"api_sortno"`
		APIShipID        int   `json:"api_ship_id"`
		APILv            int   `json:"api_lv"`
		APIExp           []int `json:"api_exp"`
		APINowhp         int   `json:"api_nowhp"`
		APIMaxhp         int   `json:"api_maxhp"`
		APISoku          int   `json:"api_soku"`
		APILeng          int   `json:"api_leng"`
		APISlot          []int `json:"api_slot"`
		APIOnslot        []int `json:"api_onslot"`
		APISlotEx        int   `json:"api_slot_ex"`
		APIKyouka        []int `json:"api_kyouka"`
		APIBacks         int   `json:"api_backs"`
		APIFuel          int   `json:"api_fuel"`
		APIBull          int   `json:"api_bull"`
		APISlotnum       int   `json:"api_slotnum"`
		APINdockTime     int   `json:"api_ndock_time"`
		APINdockItem     []int `json:"api_ndock_item"`
		APISrate         int   `json:"api_srate"`
		APICond          int   `json:"api_cond"`
		APIKaryoku       []int `json:"api_karyoku"`
		APIRaisou        []int `json:"api_raisou"`
		APITaiku         []int `json:"api_taiku"`
		APISoukou        []int `json:"api_soukou"`
		APIKaihi         []int `json:"api_kaihi"`
		APITaisen        []int `json:"api_taisen"`
		APISakuteki      []int `json:"api_sakuteki"`
		APILucky         []int `json:"api_lucky"`
		APILocked        int   `json:"api_locked"`
		APILockedEquip   int   `json:"api_locked_equip"`
		APISpEffectItems []struct {
			APIKind int `json:"api_kind"`
			APIRaig int `json:"api_raig"`
			APISouk int `json:"api_souk"`
		} `json:"api_sp_effect_items,omitempty"`
	} `json:"api_ship"`
	APIBasic struct {
		APIMemberID         string `json:"api_member_id"`
		APINickname         string `json:"api_nickname"`
		APINicknameID       string `json:"api_nickname_id"`
		APIActiveFlag       int    `json:"api_active_flag"`
		APIStarttime        int64  `json:"api_starttime"`
		APILevel            int    `json:"api_level"`
		APIRank             int    `json:"api_rank"`
		APIExperience       int    `json:"api_experience"`
		APIFleetname        any    `json:"api_fleetname"`
		APIComment          string `json:"api_comment"`
		APICommentID        string `json:"api_comment_id"`
		APIMaxChara         int    `json:"api_max_chara"`
		APIMaxSlotitem      int    `json:"api_max_slotitem"`
		APIMaxKagu          int    `json:"api_max_kagu"`
		APIPlaytime         int    `json:"api_playtime"`
		APITutorial         int    `json:"api_tutorial"`
		APIFurniture        []int  `json:"api_furniture"`
		APICountDeck        int    `json:"api_count_deck"`
		APICountKdock       int    `json:"api_count_kdock"`
		APICountNdock       int    `json:"api_count_ndock"`
		APIFcoin            int    `json:"api_fcoin"`
		APIStWin            int    `json:"api_st_win"`
		APIStLose           int    `json:"api_st_lose"`
		APIMsCount          int    `json:"api_ms_count"`
		APIMsSuccess        int    `json:"api_ms_success"`
		APIPtWin            int    `json:"api_pt_win"`
		APIPtLose           int    `json:"api_pt_lose"`
		APIPtChallenged     int    `json:"api_pt_challenged"`
		APIPtChallengedWin  int    `json:"api_pt_challenged_win"`
		APIFirstflag        int    `json:"api_firstflag"`
		APITutorialProgress int    `json:"api_tutorial_progress"`
		APIPvp              []int  `json:"api_pvp"`
		APIMedals           int    `json:"api_medals"`
		APILargeDock        int    `json:"api_large_dock"`
	} `json:"api_basic"`
	APILog []struct {
		APINo      int    `json:"api_no"`
		APIType    string `json:"api_type"`
		APIState   string `json:"api_state"`
		APIMessage string `json:"api_message"`
	} `json:"api_log"`
	APIPBgmID               int `json:"api_p_bgm_id"`
	APIFurnitureAffectItems struct {
		APIPayitemDict struct {
			Num21 int `json:"21"`
		} `json:"api_payitem_dict"`
	} `json:"api_furniture_affect_items"`
	APIParallelQuestCount int   `json:"api_parallel_quest_count"`
	APIDestShipSlot       int   `json:"api_dest_ship_slot"`
	APICFlags             []int `json:"api_c_flags"`
}

// api_get_member/mapinfo
type api_get_member__mapinfo struct {
	APIMapInfo []struct {
		APIID                  int `json:"api_id"`
		APICleared             int `json:"api_cleared"`
		APIGaugeType           int `json:"api_gauge_type,omitempty"`
		APIGaugeNum            int `json:"api_gauge_num,omitempty"`
		APIDefeatCount         int `json:"api_defeat_count,omitempty"`
		APIRequiredDefeatCount int `json:"api_required_defeat_count,omitempty"`
		APIAirBaseDecks        int `json:"api_air_base_decks,omitempty"`
	} `json:"api_map_info"`
	APIAirBase []struct {
		APIAreaID   int    `json:"api_area_id"`
		APIRid      int    `json:"api_rid"`
		APIName     string `json:"api_name"`
		APIDistance struct {
			APIBase  int `json:"api_base"`
			APIBonus int `json:"api_bonus"`
		} `json:"api_distance"`
		APIActionKind int `json:"api_action_kind"`
		APIPlaneInfo  []struct {
			APISquadronID int `json:"api_squadron_id"`
			APIState      int `json:"api_state"`
			APISlotid     int `json:"api_slotid"`
			APICount      int `json:"api_count"`
			APIMaxCount   int `json:"api_max_count"`
			APICond       int `json:"api_cond"`
		} `json:"api_plane_info"`
	} `json:"api_air_base"`
	APIAirBaseExpandedInfo []struct {
		APIAreaID           int `json:"api_area_id"`
		APIMaintenanceLevel int `json:"api_maintenance_level"`
	} `json:"api_air_base_expanded_info"`
}

// api_req_map/start
type api_req_map__start struct {
	APIResult    int    `json:"api_result"`
	APIResultMsg string `json:"api_result_msg"`
	APIData      struct {
		APICellData []struct {
			APIID       int `json:"api_id"`
			APINo       int `json:"api_no"`
			APIColorNo  int `json:"api_color_no"`
			APIPassed   int `json:"api_passed"`
			APIDistance int `json:"api_distance,omitempty"`
		} `json:"api_cell_data"`
		APIRashinFlg  int `json:"api_rashin_flg"`
		APIRashinID   int `json:"api_rashin_id"`
		APIMapareaID  int `json:"api_maparea_id"`
		APIMapinfoNo  int `json:"api_mapinfo_no"`
		APINo         int `json:"api_no"`
		APIColorNo    int `json:"api_color_no"`
		APIEventID    int `json:"api_event_id"`
		APIEventKind  int `json:"api_event_kind"`
		APINext       int `json:"api_next"`
		APIBosscellNo int `json:"api_bosscell_no"`
		APIBosscomp   int `json:"api_bosscomp"`
		APIAirsearch  struct {
			APIPlaneType int `json:"api_plane_type"`
			APIResult    int `json:"api_result"`
		} `json:"api_airsearch"`
		APIEDeckInfo []struct {
			APIKind    int   `json:"api_kind"`
			APIShipIds []int `json:"api_ship_ids"`
		} `json:"api_e_deck_info"`
		APILimitState int `json:"api_limit_state"`
		APIFromNo     int `json:"api_from_no"`
	} `json:"api_data"`
}

// api_req_sortie/battle
type api_req_sortie__battle struct {
	APIResult    int    `json:"api_result"`
	APIResultMsg string `json:"api_result_msg"`
	APIData      struct {
		APIDeckID       int     `json:"api_deck_id"`
		APIFormation    []int   `json:"api_formation"`
		APIFNowhps      []int   `json:"api_f_nowhps"`
		APIFMaxhps      []int   `json:"api_f_maxhps"`
		APIFParam       [][]int `json:"api_fParam"`
		APIShipKe       []int   `json:"api_ship_ke"`
		APIShipLv       []int   `json:"api_ship_lv"`
		APIENowhps      []int   `json:"api_e_nowhps"`
		APIEMaxhps      []int   `json:"api_e_maxhps"`
		APIESlot        [][]int `json:"api_eSlot"`
		APIEParam       [][]int `json:"api_eParam"`
		APISmokeType    int     `json:"api_smoke_type"`
		APIBalloonCell  int     `json:"api_balloon_cell"`
		APIAtollCell    int     `json:"api_atoll_cell"`
		APIMidnightFlag int     `json:"api_midnight_flag"`
		APISearch       []int   `json:"api_search"`
		APIStageFlag    []int   `json:"api_stage_flag"`
		APIKouku        struct {
			APIPlaneFrom []any `json:"api_plane_from"`
			APIStage1    struct {
				APIFCount     int   `json:"api_f_count"`
				APIFLostcount int   `json:"api_f_lostcount"`
				APIECount     int   `json:"api_e_count"`
				APIELostcount int   `json:"api_e_lostcount"`
				APIDispSeiku  int   `json:"api_disp_seiku"`
				APITouchPlane []int `json:"api_touch_plane"`
			} `json:"api_stage1"`
			APIStage2 struct {
				APIFCount     int `json:"api_f_count"`
				APIFLostcount int `json:"api_f_lostcount"`
				APIECount     int `json:"api_e_count"`
				APIELostcount int `json:"api_e_lostcount"`
			} `json:"api_stage2"`
			APIStage3 struct {
				APIFraiFlag []int `json:"api_frai_flag"`
				APIEraiFlag []int `json:"api_erai_flag"`
				APIFbakFlag []int `json:"api_fbak_flag"`
				APIEbakFlag []int `json:"api_ebak_flag"`
				APIFclFlag  []int `json:"api_fcl_flag"`
				APIEclFlag  []int `json:"api_ecl_flag"`
				APIFdam     []int `json:"api_fdam"`
				APIEdam     []int `json:"api_edam"`
				APIFSpList  []any `json:"api_f_sp_list"`
				APIESpList  []any `json:"api_e_sp_list"`
			} `json:"api_stage3"`
		} `json:"api_kouku"`
		APISupportFlag       int `json:"api_support_flag"`
		APISupportInfo       any `json:"api_support_info"`
		APIOpeningTaisenFlag int `json:"api_opening_taisen_flag"`
		APIOpeningTaisen     any `json:"api_opening_taisen"`
		APIOpeningFlag       int `json:"api_opening_flag"`
		APIOpeningAtack      struct {
			APIFraiListItems  []any `json:"api_frai_list_items"`
			APIFclListItems   []any `json:"api_fcl_list_items"`
			APIFdam           []int `json:"api_fdam"`
			APIFydamListItems []any `json:"api_fydam_list_items"`
			APIEraiListItems  []any `json:"api_erai_list_items"`
			APIEclListItems   []any `json:"api_ecl_list_items"`
			APIEdam           []int `json:"api_edam"`
			APIEydamListItems []any `json:"api_eydam_list_items"`
		} `json:"api_opening_atack"`
		APIHouraiFlag []int `json:"api_hourai_flag"`
		APIHougeki1   any   `json:"api_hougeki1"`
		APIHougeki2   any   `json:"api_hougeki2"`
		APIHougeki3   any   `json:"api_hougeki3"`
		APIRaigeki    any   `json:"api_raigeki"`
	} `json:"api_data"`
}

// api_req_battle_midnight/battle
type api_req_battle_midnight__battle struct {
	APIResult    int    `json:"api_result"`
	APIResultMsg string `json:"api_result_msg"`
	APIData      struct {
		APIDeckID      int     `json:"api_deck_id"`
		APIFormation   []int   `json:"api_formation"`
		APIFNowhps     []int   `json:"api_f_nowhps"`
		APIFMaxhps     []int   `json:"api_f_maxhps"`
		APIFParam      [][]int `json:"api_fParam"`
		APIShipKe      []int   `json:"api_ship_ke"`
		APIShipLv      []int   `json:"api_ship_lv"`
		APIENowhps     []int   `json:"api_e_nowhps"`
		APIEMaxhps     []int   `json:"api_e_maxhps"`
		APIESlot       [][]int `json:"api_eSlot"`
		APIEParam      [][]int `json:"api_eParam"`
		APISmokeType   int     `json:"api_smoke_type"`
		APIBalloonCell int     `json:"api_balloon_cell"`
		APIAtollCell   int     `json:"api_atoll_cell"`
		APITouchPlane  []int   `json:"api_touch_plane"`
		APIFlarePos    []int   `json:"api_flare_pos"`
		APIHougeki     struct {
			APIAtEflag     any `json:"api_at_eflag"`
			APIAtList      any `json:"api_at_list"`
			APINMotherList any `json:"api_n_mother_list"`
			APIDfList      any `json:"api_df_list"`
			APISiList      any `json:"api_si_list"`
			APIClList      any `json:"api_cl_list"`
			APISpList      any `json:"api_sp_list"`
			APIDamage      any `json:"api_damage"`
		} `json:"api_hougeki"`
	} `json:"api_data"`
}

// api_req_sortie/battleresult
type api_req_sortie__battleresult struct {
	APIShipID     []int   `json:"api_ship_id"`
	APIWinRank    string  `json:"api_win_rank"`
	APIGetExp     int     `json:"api_get_exp"`
	APIMvp        int     `json:"api_mvp"`
	APIMemberLv   int     `json:"api_member_lv"`
	APIMemberExp  int     `json:"api_member_exp"`
	APIGetBaseExp int     `json:"api_get_base_exp"`
	APIGetShipExp []int   `json:"api_get_ship_exp"`
	APIGetExpLvup [][]int `json:"api_get_exp_lvup"`
	APIDests      int     `json:"api_dests"`
	APIDestsf     int     `json:"api_destsf"`
	APIQuestName  string  `json:"api_quest_name"`
	APIQuestLevel int     `json:"api_quest_level"`
	APIEnemyInfo  struct {
		APILevel    string `json:"api_level"`
		APIRank     string `json:"api_rank"`
		APIDeckName string `json:"api_deck_name"`
	} `json:"api_enemy_info"`
	APIFirstClear       int   `json:"api_first_clear"`
	APIMapcellIncentive int   `json:"api_mapcell_incentive"`
	APIGetFlag          []int `json:"api_get_flag"`
	APIGetShip          struct {
		APIShipID     int    `json:"api_ship_id"`
		APIShipType   string `json:"api_ship_type"`
		APIShipName   string `json:"api_ship_name"`
		APIShipGetmes string `json:"api_ship_getmes"`
	} `json:"api_get_ship"`
	APIGetEventflag      int `json:"api_get_eventflag"`
	APIGetExmapRate      int `json:"api_get_exmap_rate"`
	APIGetExmapUseitemID int `json:"api_get_exmap_useitem_id"`
	APIEscapeFlag        int `json:"api_escape_flag"`
	APIEscape            any `json:"api_escape"`
}

// api_get_menber/ship_deck
type api_get_menber__ship_deck struct {
	APIResult    int    `json:"api_result"`
	APIResultMsg string `json:"api_result_msg"`
	APIData      struct {
		APIShipData []struct {
			APIID          int   `json:"api_id"`
			APISortno      int   `json:"api_sortno"`
			APIShipID      int   `json:"api_ship_id"`
			APILv          int   `json:"api_lv"`
			APIExp         []int `json:"api_exp"`
			APINowhp       int   `json:"api_nowhp"`
			APIMaxhp       int   `json:"api_maxhp"`
			APISoku        int   `json:"api_soku"`
			APILeng        int   `json:"api_leng"`
			APISlot        []int `json:"api_slot"`
			APIOnslot      []int `json:"api_onslot"`
			APISlotEx      int   `json:"api_slot_ex"`
			APIKyouka      []int `json:"api_kyouka"`
			APIBacks       int   `json:"api_backs"`
			APIFuel        int   `json:"api_fuel"`
			APIBull        int   `json:"api_bull"`
			APISlotnum     int   `json:"api_slotnum"`
			APINdockTime   int   `json:"api_ndock_time"`
			APINdockItem   []int `json:"api_ndock_item"`
			APISrate       int   `json:"api_srate"`
			APICond        int   `json:"api_cond"`
			APIKaryoku     []int `json:"api_karyoku"`
			APIRaisou      []int `json:"api_raisou"`
			APITaiku       []int `json:"api_taiku"`
			APISoukou      []int `json:"api_soukou"`
			APIKaihi       []int `json:"api_kaihi"`
			APITaisen      []int `json:"api_taisen"`
			APISakuteki    []int `json:"api_sakuteki"`
			APILucky       []int `json:"api_lucky"`
			APILocked      int   `json:"api_locked"`
			APILockedEquip int   `json:"api_locked_equip"`
		} `json:"api_ship_data"`
		APIDeckData []struct {
			APIMemberID int    `json:"api_member_id"`
			APIID       int    `json:"api_id"`
			APIName     string `json:"api_name"`
			APINameID   string `json:"api_name_id"`
			APIMission  []int  `json:"api_mission"`
			APIFlagship string `json:"api_flagship"`
			APIShip     []int  `json:"api_ship"`
		} `json:"api_deck_data"`
	} `json:"api_data"`
}

// api_req_map/next
type api_req_map__next struct {
	APIRashinFlg      int `json:"api_rashin_flg"`
	APIRashinID       int `json:"api_rashin_id"`
	APIMapareaID      int `json:"api_maparea_id"`
	APIMapinfoNo      int `json:"api_mapinfo_no"`
	APINo             int `json:"api_no"`
	APIColorNo        int `json:"api_color_no"`
	APIEventID        int `json:"api_event_id"`
	APIEventKind      int `json:"api_event_kind"`
	APINext           int `json:"api_next"`
	APIBosscellNo     int `json:"api_bosscell_no"`
	APIBosscomp       int `json:"api_bosscomp"`
	APICommentKind    int `json:"api_comment_kind"`
	APIProductionKind int `json:"api_production_kind"`
	APIAirsearch      struct {
		APIPlaneType int `json:"api_plane_type"`
		APIResult    int `json:"api_result"`
	} `json:"api_airsearch"`
	APIEDeckInfo []struct {
		APIKind    int   `json:"api_kind"`
		APIShipIds []int `json:"api_ship_ids"`
	} `json:"api_e_deck_info"`
	APILimitState int `json:"api_limit_state"`
}

// api_req_sortie/ld_airbattle
type api_req_sortie__ld_airbattle struct {
	APIResult    int    `json:"api_result"`
	APIResultMsg string `json:"api_result_msg"`
	APIData      struct {
		APIDeckID       int     `json:"api_deck_id"`
		APIFormation    []int   `json:"api_formation"`
		APIFNowhps      []int   `json:"api_f_nowhps"`
		APIFMaxhps      []int   `json:"api_f_maxhps"`
		APIFParam       [][]int `json:"api_fParam"`
		APIShipKe       []int   `json:"api_ship_ke"`
		APIShipLv       []int   `json:"api_ship_lv"`
		APIENowhps      []int   `json:"api_e_nowhps"`
		APIEMaxhps      []int   `json:"api_e_maxhps"`
		APIESlot        [][]int `json:"api_eSlot"`
		APIEParam       [][]int `json:"api_eParam"`
		APISmokeType    int     `json:"api_smoke_type"`
		APIBalloonCell  int     `json:"api_balloon_cell"`
		APIAtollCell    int     `json:"api_atoll_cell"`
		APIMidnightFlag int     `json:"api_midnight_flag"`
		APISearch       []int   `json:"api_search"`
		APIStageFlag    []int   `json:"api_stage_flag"`
		APIKouku        struct {
			APIPlaneFrom [][]int `json:"api_plane_from"`
			APIStage1    struct {
				APIFCount     int   `json:"api_f_count"`
				APIFLostcount int   `json:"api_f_lostcount"`
				APIECount     int   `json:"api_e_count"`
				APIELostcount int   `json:"api_e_lostcount"`
				APIDispSeiku  int   `json:"api_disp_seiku"`
				APITouchPlane []int `json:"api_touch_plane"`
			} `json:"api_stage1"`
			APIStage2 struct {
				APIFCount     int `json:"api_f_count"`
				APIFLostcount int `json:"api_f_lostcount"`
				APIECount     int `json:"api_e_count"`
				APIELostcount int `json:"api_e_lostcount"`
			} `json:"api_stage2"`
			APIStage3 struct {
				APIFraiFlag []int `json:"api_frai_flag"`
				APIEraiFlag []int `json:"api_erai_flag"`
				APIFbakFlag []int `json:"api_fbak_flag"`
				APIEbakFlag []int `json:"api_ebak_flag"`
				APIFclFlag  []int `json:"api_fcl_flag"`
				APIEclFlag  []int `json:"api_ecl_flag"`
				APIFdam     []int `json:"api_fdam"`
				APIEdam     []int `json:"api_edam"`
				APIFSpList  []any `json:"api_f_sp_list"`
				APIESpList  []any `json:"api_e_sp_list"`
			} `json:"api_stage3"`
		} `json:"api_kouku"`
	} `json:"api_data"`
}
