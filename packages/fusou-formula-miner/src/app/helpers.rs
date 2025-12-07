//! Helper utilities for application state management

use crate::state::SolverState;

/// Push a log message to the state, managing log size and scroll position
pub fn push_log(state: &mut SolverState, message: String) {
    // Filter out very noisy smart-init generation logs
    if message.contains("Smart-init: generated") {
        return;
    }

    // Preserve user's scroll position unless they were viewing the bottom
    let was_at_bottom = state.log_scroll_offset == 0;
    state.logs.push(message);
    if state.logs.len() > 2000 {
        state.logs.drain(0..state.logs.len() - 2000);
    }
    if was_at_bottom {
        state.log_scroll_offset = 0;
    }
}
