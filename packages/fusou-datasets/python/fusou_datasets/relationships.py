
from __future__ import annotations
from typing import TYPE_CHECKING
from .schema import Tables

if TYPE_CHECKING:
    from .query_engine import JoinGraph

def define_core_relationships(graph: JoinGraph) -> None:
    """
    Define the core table relationships for the auto-join engine.
    Developers should edit this file to add or modify supported joins.
    
    Args:
        graph: The JoinGraph instance (REGISTRY)
    
    Relationship structure based on kc-api-database models:
    - Battle references OwnDeck, EnemyDeck, FriendDeck, SupportDeck via UUID
    - OwnDeck/EnemyDeck/FriendDeck/SupportDeck reference Ship collections via SHIP_IDS
    - Ships reference master data (ShipMaster) via SHIP_ID/MST_SHIP_ID
    - OwnShip references OwnSlotitem collection via SLOT/SLOT_EX
    - Slotitems reference master data (SlotItemMaster) via MST_SLOTITEM_ID
    - Battle references Cells via CELL_ID
    - All entities reference EnvInfo via ENV_UUID
    """
    
    # =============================================================================
    # Environment & Context
    # =============================================================================
    
    # Battle -> EnvInfo
    graph.add(Tables.Battle.TABLE, Tables.Battle.ENV_UUID, Tables.EnvInfo.TABLE, Tables.EnvInfo.UUID)
    
    # Battle -> Cells (Map information)
    graph.add(Tables.Battle.TABLE, Tables.Battle.CELL_ID, Tables.Cells.TABLE, Tables.Cells.BATTLES)
    
    # Cells -> MapInfoMaster
    graph.add(Tables.Cells.TABLE, Tables.Cells.MAPINFO_NO, Tables.MapInfoMaster.TABLE, Tables.MapInfoMaster.NO)
    
    # Cells -> MapAreaMaster
    graph.add(Tables.Cells.TABLE, Tables.Cells.MAPAREA_ID, Tables.MapAreaMaster.TABLE, Tables.MapAreaMaster.ID)
    
    # MapInfoMaster -> MapAreaMaster
    graph.add(Tables.MapInfoMaster.TABLE, Tables.MapInfoMaster.MAPAREA_ID, Tables.MapAreaMaster.TABLE, Tables.MapAreaMaster.ID)
    
    # =============================================================================
    # Battle -> Decks (Own, Enemy, Friend, Support)
    # =============================================================================
    
    # Battle -> OwnDeck (friendly fleet deck)
    graph.add(Tables.Battle.TABLE, Tables.Battle.F_DECK_ID, Tables.OwnDeck.TABLE, Tables.OwnDeck.UUID)
    
    # Battle -> EnemyDeck
    graph.add(Tables.Battle.TABLE, Tables.Battle.E_DECK_ID, Tables.EnemyDeck.TABLE, Tables.EnemyDeck.UUID)
    
    # Battle -> FriendDeck (friendly reinforcement fleet)
    graph.add(Tables.Battle.TABLE, Tables.Battle.FRIEND_DECK_ID, Tables.FriendDeck.TABLE, Tables.FriendDeck.UUID)
    
    # Battle -> SupportDeck
    graph.add(Tables.Battle.TABLE, Tables.Battle.SUPPORT_DECK_ID, Tables.SupportDeck.TABLE, Tables.SupportDeck.UUID)
    
    # =============================================================================
    # Decks -> Ships
    # =============================================================================
    
    # OwnDeck -> OwnShip (via SHIP_IDS UUID reference)
    graph.add(Tables.OwnDeck.TABLE, Tables.OwnDeck.SHIP_IDS, Tables.OwnShip.TABLE, Tables.OwnShip.UUID)
    
    # EnemyDeck -> EnemyShip
    graph.add(Tables.EnemyDeck.TABLE, Tables.EnemyDeck.SHIP_IDS, Tables.EnemyShip.TABLE, Tables.EnemyShip.UUID)
    
    # FriendDeck -> FriendShip
    graph.add(Tables.FriendDeck.TABLE, Tables.FriendDeck.SHIP_IDS, Tables.FriendShip.TABLE, Tables.FriendShip.UUID)
    
    # SupportDeck -> OwnShip (support uses OwnShip structure)
    graph.add(Tables.SupportDeck.TABLE, Tables.SupportDeck.SHIP_IDS, Tables.OwnShip.TABLE, Tables.OwnShip.UUID)
    
    # =============================================================================
    # Ships -> Master Data
    # =============================================================================
    
    # OwnShip -> ShipMaster
    graph.add(Tables.OwnShip.TABLE, Tables.OwnShip.SHIP_ID, Tables.ShipMaster.TABLE, Tables.ShipMaster.ID)
    
    # EnemyShip -> ShipMaster
    graph.add(Tables.EnemyShip.TABLE, Tables.EnemyShip.MST_SHIP_ID, Tables.ShipMaster.TABLE, Tables.ShipMaster.ID)
    
    # FriendShip -> ShipMaster
    graph.add(Tables.FriendShip.TABLE, Tables.FriendShip.MST_SHIP_ID, Tables.ShipMaster.TABLE, Tables.ShipMaster.ID)
    
    # =============================================================================
    # ShipMaster -> ShipType
    # =============================================================================
    
    # ShipMaster -> ShipType
    graph.add(Tables.ShipMaster.TABLE, Tables.ShipMaster.STYPE, Tables.ShipType.TABLE, Tables.ShipType.ID)
    
    # =============================================================================
    # Ships -> Equipment (Slotitems)
    # =============================================================================
    
    # OwnShip -> OwnSlotitem (via SLOT UUID reference)
    graph.add(Tables.OwnShip.TABLE, Tables.OwnShip.SLOT, Tables.OwnSlotitem.TABLE, Tables.OwnSlotitem.UUID)
    
    # OwnShip -> OwnSlotitem (via SLOT_EX UUID reference for reinforcement expansion)
    graph.add(Tables.OwnShip.TABLE, Tables.OwnShip.SLOT_EX, Tables.OwnSlotitem.TABLE, Tables.OwnSlotitem.UUID)
    
    # EnemyShip -> EnemySlotitem
    graph.add(Tables.EnemyShip.TABLE, Tables.EnemyShip.SLOT, Tables.EnemySlotitem.TABLE, Tables.EnemySlotitem.UUID)
    
    # FriendShip -> FriendSlotitem
    graph.add(Tables.FriendShip.TABLE, Tables.FriendShip.SLOT, Tables.FriendSlotitem.TABLE, Tables.FriendSlotitem.UUID)
    
    # =============================================================================
    # Slotitems -> Master Data
    # =============================================================================
    
    # OwnSlotitem -> SlotItemMaster
    graph.add(Tables.OwnSlotitem.TABLE, Tables.OwnSlotitem.MST_SLOTITEM_ID, Tables.SlotItemMaster.TABLE, Tables.SlotItemMaster.ID)
    
    # EnemySlotitem -> SlotItemMaster
    graph.add(Tables.EnemySlotitem.TABLE, Tables.EnemySlotitem.MST_SLOTITEM_ID, Tables.SlotItemMaster.TABLE, Tables.SlotItemMaster.ID)
    
    # FriendSlotitem -> SlotItemMaster
    graph.add(Tables.FriendSlotitem.TABLE, Tables.FriendSlotitem.MST_SLOTITEM_ID, Tables.SlotItemMaster.TABLE, Tables.SlotItemMaster.ID)
    
    # =============================================================================
    # Battle -> Attack/Action Details
    # =============================================================================
    
    # Battle -> HougekiList (shelling attacks)
    graph.add(Tables.Battle.TABLE, Tables.Battle.HOUGEKI, Tables.HougekiList.TABLE, Tables.HougekiList.UUID)
    
    # HougekiList -> Hougeki
    graph.add(Tables.HougekiList.TABLE, Tables.HougekiList.HOUGEKI, Tables.Hougeki.TABLE, Tables.Hougeki.UUID)
    
    # Battle -> MidnightHougekiList
    graph.add(Tables.Battle.TABLE, Tables.Battle.MIDNIGHT_HOUGEKI, Tables.MidnightHougekiList.TABLE, Tables.MidnightHougekiList.UUID)
    
    # MidnightHougekiList -> MidnightHougeki
    graph.add(Tables.MidnightHougekiList.TABLE, Tables.MidnightHougekiList.MIDNIGHT_HOUGEKI, Tables.MidnightHougeki.TABLE, Tables.MidnightHougeki.UUID)
    
    # Battle -> OpeningTaisenList (opening anti-submarine)
    graph.add(Tables.Battle.TABLE, Tables.Battle.OPENING_TAISEN, Tables.OpeningTaisenList.TABLE, Tables.OpeningTaisenList.UUID)
    
    # OpeningTaisenList -> OpeningTaisen
    graph.add(Tables.OpeningTaisenList.TABLE, Tables.OpeningTaisenList.OPENING_TAISEN, Tables.OpeningTaisen.TABLE, Tables.OpeningTaisen.UUID)
    
    # Battle -> OpeningRaigeki (opening torpedo attack)
    graph.add(Tables.Battle.TABLE, Tables.Battle.OPENING_RAIGEKI, Tables.OpeningRaigeki.TABLE, Tables.OpeningRaigeki.UUID)
    
    # Battle -> ClosingRaigeki (closing torpedo attack)
    graph.add(Tables.Battle.TABLE, Tables.Battle.CLOSING_RAIGEKI, Tables.ClosingRaigeki.TABLE, Tables.ClosingRaigeki.UUID)
    
    # Battle -> OpeningAirattackList (opening aerial combat)
    graph.add(Tables.Battle.TABLE, Tables.Battle.OPENING_AIR_ATTACK, Tables.OpeningAirattackList.TABLE, Tables.OpeningAirattackList.UUID)
    
    # OpeningAirattackList -> OpeningAirattack
    graph.add(Tables.OpeningAirattackList.TABLE, Tables.OpeningAirattackList.OPENING_AIR_ATTACK, Tables.OpeningAirattack.TABLE, Tables.OpeningAirattack.UUID)
    
    # Battle -> CarrierbaseAssault
    graph.add(Tables.Battle.TABLE, Tables.Battle.CARRIER_BASE_ASSAULT, Tables.CarrierbaseAssault.TABLE, Tables.CarrierbaseAssault.UUID)
    
    # Battle -> AirbaseAssult
    graph.add(Tables.Battle.TABLE, Tables.Battle.AIR_BASE_ASSAULT, Tables.AirbaseAssult.TABLE, Tables.AirbaseAssult.UUID)
    
    # Battle -> AirbaseAirattackList
    graph.add(Tables.Battle.TABLE, Tables.Battle.AIR_BASE_AIR_ATTACKS, Tables.AirbaseAirattackList.TABLE, Tables.AirbaseAirattackList.UUID)
    
    # AirbaseAirattackList -> AirbaseAirattack
    graph.add(Tables.AirbaseAirattackList.TABLE, Tables.AirbaseAirattackList.AIR_BASE_AIR_ATTACK, Tables.AirbaseAirattack.TABLE, Tables.AirbaseAirattack.UUID)
    
    # Battle -> SupportHourai
    graph.add(Tables.Battle.TABLE, Tables.Battle.SUPPORT_HOURAI, Tables.SupportHourai.TABLE, Tables.SupportHourai.UUID)
    
    # Battle -> SupportAirattack
    graph.add(Tables.Battle.TABLE, Tables.Battle.SUPPORT_AIRATTACK, Tables.SupportAirattack.TABLE, Tables.SupportAirattack.UUID)
    
    # Battle -> FriendlySupportHouraiList
    graph.add(Tables.Battle.TABLE, Tables.Battle.FRIENDLY_FORCE_ATTACK, Tables.FriendlySupportHouraiList.TABLE, Tables.FriendlySupportHouraiList.UUID)
    
    # FriendlySupportHouraiList -> FriendlySupportHourai
    graph.add(Tables.FriendlySupportHouraiList.TABLE, Tables.FriendlySupportHouraiList.HOURAI_LIST, Tables.FriendlySupportHourai.TABLE, Tables.FriendlySupportHourai.UUID)
    
    # =============================================================================
    # Airbase
    # =============================================================================
    
    # AirbaseAirattack -> Airbase
    graph.add(Tables.AirbaseAirattack.TABLE, Tables.AirbaseAirattack.AIRBASE_ID, Tables.Airbase.TABLE, Tables.Airbase.UUID)
    
    # Airbase -> PlaneInfo
    graph.add(Tables.Airbase.TABLE, Tables.Airbase.PLANE_INFO, Tables.PlaneInfo.TABLE, Tables.PlaneInfo.UUID)
    
    # AirbaseAssult -> PlaneInfo (via SQUADRON_PLANE)
    graph.add(Tables.AirbaseAssult.TABLE, Tables.AirbaseAssult.SQUADRON_PLANE, Tables.PlaneInfo.TABLE, Tables.PlaneInfo.UUID)
    
    # AirbaseAirattack -> PlaneInfo (via SQUADRON_PLANE)
    graph.add(Tables.AirbaseAirattack.TABLE, Tables.AirbaseAirattack.SQUADRON_PLANE, Tables.PlaneInfo.TABLE, Tables.PlaneInfo.UUID)
    
    # PlaneInfo -> SlotItemMaster (via SLOTID)
    graph.add(Tables.PlaneInfo.TABLE, Tables.PlaneInfo.SLOTID, Tables.SlotItemMaster.TABLE, Tables.SlotItemMaster.ID)
