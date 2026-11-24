use serde::{Deserialize, Serialize};

pub const COMBINED_TITLEBAR_HEIGHT: f64 = 32.0;
pub const MIN_PANEL_RATIO_PERCENT: u32 = 15;
pub const MAX_PANEL_RATIO_PERCENT: u32 = 80;
pub const DEFAULT_PANEL_RATIO_PERCENT: u32 = 30;
pub const MIN_GAME_AXIS: f64 = 240.0;
pub const MIN_PANEL_AXIS: f64 = 220.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowMode {
    Separate,
    Combined,
}

impl WindowMode {
    pub fn from_config_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "combined" => Self::Combined,
            _ => Self::Separate,
        }
    }

    #[allow(dead_code)]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Separate => "separate",
            Self::Combined => "combined",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockPosition {
    Auto,
    Right,
    Bottom,
    Left,
    Top,
}

impl DockPosition {
    pub fn from_config_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "auto" => Self::Auto,
            "bottom" => Self::Bottom,
            "left" => Self::Left,
            "top" => Self::Top,
            _ => Self::Right,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Right => "right",
            Self::Bottom => "bottom",
            Self::Left => "left",
            Self::Top => "top",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EffectiveDockPosition {
    Right,
    Bottom,
    Left,
    Top,
}

impl EffectiveDockPosition {
    pub fn is_horizontal(self) -> bool {
        matches!(self, Self::Right | Self::Left)
    }

    #[allow(dead_code)]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Right => "right",
            Self::Bottom => "bottom",
            Self::Left => "left",
            Self::Top => "top",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DockEdgeFlags {
    pub top: bool,
    pub bottom: bool,
    pub left: bool,
    pub right: bool,
}

impl DockEdgeFlags {
    pub fn all() -> Self {
        Self {
            top: true,
            bottom: true,
            left: true,
            right: true,
        }
    }

    pub fn panel_edges(effective_dock: EffectiveDockPosition, game_visible: bool) -> Self {
        if !game_visible {
            return Self {
                top: false,
                bottom: true,
                left: true,
                right: true,
            };
        }

        match effective_dock {
            EffectiveDockPosition::Right => Self {
                top: false,
                bottom: true,
                left: false,
                right: true,
            },
            EffectiveDockPosition::Left => Self {
                top: false,
                bottom: true,
                left: true,
                right: false,
            },
            EffectiveDockPosition::Bottom => Self {
                top: false,
                bottom: true,
                left: true,
                right: true,
            },
            EffectiveDockPosition::Top => Self {
                top: false,
                bottom: false,
                left: true,
                right: true,
            },
        }
    }

    pub fn game_edges(effective_dock: EffectiveDockPosition) -> Self {
        match effective_dock {
            EffectiveDockPosition::Right => Self {
                top: false,
                bottom: true,
                left: true,
                right: false,
            },
            EffectiveDockPosition::Left => Self {
                top: false,
                bottom: true,
                left: false,
                right: true,
            },
            EffectiveDockPosition::Bottom => Self {
                top: false,
                bottom: false,
                left: true,
                right: true,
            },
            EffectiveDockPosition::Top => Self {
                top: false,
                bottom: true,
                left: true,
                right: true,
            },
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CombinedLayoutInput {
    pub total_width: f64,
    pub total_height: f64,
    pub titlebar_height: f64,
    pub dock_position: DockPosition,
    pub panel_ratio_percent: u32,
    pub game_visible: bool,
    pub min_game_axis: f64,
    pub min_panel_axis: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CombinedLayoutOutput {
    pub effective_dock: EffectiveDockPosition,
    pub titlebar: LogicalRect,
    pub game: Option<LogicalRect>,
    pub panel: LogicalRect,
}

pub fn clamp_panel_ratio(ratio_percent: u32) -> u32 {
    ratio_percent.clamp(MIN_PANEL_RATIO_PERCENT, MAX_PANEL_RATIO_PERCENT)
}

pub fn resolve_effective_window_mode(configured: WindowMode, is_mobile: bool) -> WindowMode {
    if is_mobile {
        WindowMode::Combined
    } else {
        configured
    }
}

pub fn resolve_dock_position(
    dock: DockPosition,
    workspace_width: f64,
    workspace_height: f64,
) -> EffectiveDockPosition {
    match dock {
        DockPosition::Auto => {
            if workspace_width >= workspace_height {
                EffectiveDockPosition::Right
            } else {
                EffectiveDockPosition::Bottom
            }
        }
        DockPosition::Right => EffectiveDockPosition::Right,
        DockPosition::Bottom => EffectiveDockPosition::Bottom,
        DockPosition::Left => EffectiveDockPosition::Left,
        DockPosition::Top => EffectiveDockPosition::Top,
    }
}

pub fn compute_combined_layout(input: CombinedLayoutInput) -> CombinedLayoutOutput {
    let total_w = input.total_width.max(1.0);
    let total_h = input.total_height.max(1.0);
    let titlebar_h = input.titlebar_height.clamp(0.0, (total_h - 1.0).max(0.0));
    let ws_y = titlebar_h;
    let ws_w = total_w;
    let ws_h = (total_h - titlebar_h).max(1.0);

    let effective_dock = resolve_dock_position(input.dock_position, ws_w, ws_h);
    let titlebar = LogicalRect {
        x: 0.0,
        y: 0.0,
        width: ws_w,
        height: titlebar_h,
    };

    if !input.game_visible {
        return CombinedLayoutOutput {
            effective_dock,
            titlebar,
            game: None,
            panel: LogicalRect {
                x: 0.0,
                y: ws_y,
                width: ws_w,
                height: ws_h,
            },
        };
    }

    let ratio = clamp_panel_ratio(input.panel_ratio_percent) as f64 / 100.0;
    let axis = if effective_dock.is_horizontal() {
        ws_w
    } else {
        ws_h
    };

    let min_panel = input.min_panel_axis.min(axis * 0.45).max(1.0);
    let min_game = input.min_game_axis.min(axis * 0.45).max(1.0);
    let max_panel = (axis - min_game).max(min_panel);
    let panel_axis = (axis * ratio).round().clamp(min_panel, max_panel);
    let game_axis = (axis - panel_axis).max(1.0);

    let (game, panel) = match effective_dock {
        EffectiveDockPosition::Right => (
            LogicalRect {
                x: 0.0,
                y: ws_y,
                width: game_axis,
                height: ws_h,
            },
            LogicalRect {
                x: game_axis,
                y: ws_y,
                width: panel_axis,
                height: ws_h,
            },
        ),
        EffectiveDockPosition::Left => (
            LogicalRect {
                x: panel_axis,
                y: ws_y,
                width: game_axis,
                height: ws_h,
            },
            LogicalRect {
                x: 0.0,
                y: ws_y,
                width: panel_axis,
                height: ws_h,
            },
        ),
        EffectiveDockPosition::Bottom => (
            LogicalRect {
                x: 0.0,
                y: ws_y,
                width: ws_w,
                height: game_axis,
            },
            LogicalRect {
                x: 0.0,
                y: ws_y + game_axis,
                width: ws_w,
                height: panel_axis,
            },
        ),
        EffectiveDockPosition::Top => (
            LogicalRect {
                x: 0.0,
                y: ws_y + panel_axis,
                width: ws_w,
                height: game_axis,
            },
            LogicalRect {
                x: 0.0,
                y: ws_y,
                width: ws_w,
                height: panel_axis,
            },
        ),
    };

    CombinedLayoutOutput {
        effective_dock,
        titlebar,
        game: Some(game),
        panel,
    }
}

pub fn compute_ratio_from_pointer(
    effective_dock: EffectiveDockPosition,
    workspace_x: f64,
    workspace_y: f64,
    workspace_width: f64,
    workspace_height: f64,
    pointer_x: f64,
    pointer_y: f64,
) -> u32 {
    let raw_ratio = match effective_dock {
        EffectiveDockPosition::Right => {
            let panel_w = (workspace_x + workspace_width) - pointer_x;
            (panel_w / workspace_width.max(1.0)) * 100.0
        }
        EffectiveDockPosition::Left => {
            let panel_w = pointer_x - workspace_x;
            (panel_w / workspace_width.max(1.0)) * 100.0
        }
        EffectiveDockPosition::Bottom => {
            let panel_h = (workspace_y + workspace_height) - pointer_y;
            (panel_h / workspace_height.max(1.0)) * 100.0
        }
        EffectiveDockPosition::Top => {
            let panel_h = pointer_y - workspace_y;
            (panel_h / workspace_height.max(1.0)) * 100.0
        }
    };

    if !raw_ratio.is_finite() {
        return DEFAULT_PANEL_RATIO_PERCENT;
    }

    clamp_panel_ratio(raw_ratio.round().clamp(0.0, 100.0) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_always_resolves_to_combined_mode() {
        assert_eq!(
            resolve_effective_window_mode(WindowMode::Separate, true),
            WindowMode::Combined
        );
        assert_eq!(
            resolve_effective_window_mode(WindowMode::Separate, false),
            WindowMode::Separate
        );
        assert_eq!(
            resolve_effective_window_mode(WindowMode::Combined, false),
            WindowMode::Combined
        );
    }

    #[test]
    fn auto_dock_adapts_to_landscape_and_portrait() {
        assert_eq!(
            resolve_dock_position(DockPosition::Auto, 1600.0, 720.0),
            EffectiveDockPosition::Right
        );
        assert_eq!(
            resolve_dock_position(DockPosition::Auto, 420.0, 860.0),
            EffectiveDockPosition::Bottom
        );
    }

    #[test]
    fn right_and_bottom_layouts_tile_without_overlap_or_gap() {
        let right = compute_combined_layout(CombinedLayoutInput {
            total_width: 1600.0,
            total_height: 752.0,
            titlebar_height: 32.0,
            dock_position: DockPosition::Right,
            panel_ratio_percent: 25,
            game_visible: true,
            min_game_axis: MIN_GAME_AXIS,
            min_panel_axis: MIN_PANEL_AXIS,
        });
        let game = right.game.expect("game rect expected");
        assert_eq!(right.titlebar.height, 32.0);
        assert_eq!(game.x, 0.0);
        assert_eq!(game.y, 32.0);
        assert_eq!(game.width, 1200.0);
        assert_eq!(right.panel.x, 1200.0);
        assert_eq!(right.panel.width, 400.0);
        assert_eq!(game.width + right.panel.width, 1600.0);

        let bottom = compute_combined_layout(CombinedLayoutInput {
            total_width: 1200.0,
            total_height: 1032.0,
            titlebar_height: 32.0,
            dock_position: DockPosition::Bottom,
            panel_ratio_percent: 30,
            game_visible: true,
            min_game_axis: MIN_GAME_AXIS,
            min_panel_axis: MIN_PANEL_AXIS,
        });
        let game_b = bottom.game.expect("game rect expected");
        assert_eq!(game_b.y, 32.0);
        assert_eq!(game_b.height, 700.0);
        assert_eq!(bottom.panel.y, 732.0);
        assert_eq!(bottom.panel.height, 300.0);
        assert_eq!(game_b.height + bottom.panel.height, 1000.0);
    }

    #[test]
    fn hidden_game_expands_panel_to_full_workspace() {
        let layout = compute_combined_layout(CombinedLayoutInput {
            total_width: 1200.0,
            total_height: 752.0,
            titlebar_height: 32.0,
            dock_position: DockPosition::Right,
            panel_ratio_percent: 30,
            game_visible: false,
            min_game_axis: MIN_GAME_AXIS,
            min_panel_axis: MIN_PANEL_AXIS,
        });
        assert!(layout.game.is_none());
        assert_eq!(
            layout.panel,
            LogicalRect {
                x: 0.0,
                y: 32.0,
                width: 1200.0,
                height: 720.0,
            }
        );
    }

    #[test]
    fn pointer_drag_maps_back_to_clamped_panel_ratio() {
        assert_eq!(
            compute_ratio_from_pointer(
                EffectiveDockPosition::Right,
                0.0,
                32.0,
                1000.0,
                700.0,
                700.0,
                400.0
            ),
            30
        );
        assert_eq!(
            compute_ratio_from_pointer(
                EffectiveDockPosition::Left,
                0.0,
                32.0,
                1000.0,
                700.0,
                50.0,
                400.0
            ),
            MIN_PANEL_RATIO_PERCENT
        );
        assert_eq!(
            compute_ratio_from_pointer(
                EffectiveDockPosition::Bottom,
                0.0,
                32.0,
                1000.0,
                700.0,
                500.0,
                32.0 + 490.0
            ),
            30
        );
        assert_eq!(
            compute_ratio_from_pointer(
                EffectiveDockPosition::Top,
                0.0,
                32.0,
                1000.0,
                700.0,
                500.0,
                32.0 + 680.0
            ),
            MAX_PANEL_RATIO_PERCENT
        );
    }
}
