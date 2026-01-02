
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
    """
    
    # Battle -> OwnDeck
    graph.add(Tables.Battle.TABLE, Tables.Battle.F_DECK_ID, Tables.OwnDeck.TABLE, Tables.OwnDeck.UUID)
    
    # Battle -> Cells
    graph.add(Tables.Battle.TABLE, Tables.Battle.CELL_ID, Tables.Cells.TABLE, Tables.Cells.BATTLES)
    
    # Battle -> EnvInfo (Environment UUID)
    graph.add(Tables.Battle.TABLE, Tables.Battle.ENV_UUID, Tables.EnvInfo.TABLE, Tables.EnvInfo.UUID)
    
    # OwnShip -> ShipMaster
    graph.add(Tables.OwnShip.TABLE, Tables.OwnShip.SHIP_ID, Tables.ShipMaster.TABLE, Tables.ShipMaster.ID)
    
    # OwnSlotitem -> SlotItemMaster
    graph.add(Tables.OwnSlotitem.TABLE, Tables.OwnSlotitem.MST_SLOTITEM_ID, Tables.SlotItemMaster.TABLE, Tables.SlotItemMaster.ID)

    # TODO: Add more relationships here as the schema evolves.
    # Example:
    # graph.add(Tables.Battle.TABLE, Tables.Battle.F_FORMATION, Tables.FormationMaster.TABLE, ...)
