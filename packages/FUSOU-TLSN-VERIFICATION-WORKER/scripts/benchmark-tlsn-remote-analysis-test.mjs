#!/usr/bin/env node

import assert from "node:assert/strict";
import { derivePollingSample, diagnosePollingSchedule } from "./benchmark-tlsn-remote.mjs";

function sample(overrides = {}) {
  return {
    case_label: "C1",
    concurrency: 1,
    sample_index: 0,
    initial_202_response_received_epoch_ms: 1_000,
    client_terminal_observed_epoch_ms: 1_110,
    benchmark_server_completion_epoch_ms: null,
    server_completion_epoch_source: "missing",
    caller_direct_invocation_completed_epoch_ms: null,
    polling_status_request_count: 2,
    polling_wait_before_first_status_request_ms: 0,
    polling_wait_between_status_requests_ms: 100,
    polling_status_request_round_trip_ms: 20,
    client_visible_ms: 110,
    server_completion_ms: 50,
    server_to_client_observation_delay_ms: null,
    poll_events: [
      {
        request_started_epoch_ms: 1_000,
        response_received_epoch_ms: 1_010,
        status: 202,
        terminal: false,
        request_round_trip_ms: 10,
        wait_before_request_ms: 0,
      },
      {
        request_started_epoch_ms: 1_100,
        response_received_epoch_ms: 1_110,
        status: 200,
        terminal: true,
        request_round_trip_ms: 10,
        wait_before_request_ms: 90,
      },
    ],
    ...overrides,
  };
}

const callerFallback = derivePollingSample(sample({
  benchmark_server_completion_epoch_ms: 1_050,
  server_completion_epoch_source: "caller_direct_invocation_fallback",
  caller_direct_invocation_completed_epoch_ms: 1_050,
}));
assert.equal(callerFallback.benchmark_server_completion_epoch_ms, null);
assert.equal(callerFallback.caller_direct_invocation_completed_epoch_ms, 1_050);
assert.equal(callerFallback.completion_to_terminal_poll_start_ms, null);
assert.deepEqual(diagnosePollingSchedule([callerFallback]), {
  classification: "inconclusive",
  basis: "server_completion_epoch_unavailable",
  authoritative_completion_epoch_sample_count: 0,
  unavailable_completion_epoch_sample_count: 1,
  schedule_component_p95_ms: null,
  terminal_exchange_component_p95_ms: null,
  schedule_component_sample_count: 0,
  terminal_exchange_component_sample_count: 0,
});

const authoritative = derivePollingSample(sample({
  benchmark_server_completion_epoch_ms: 1_050,
  server_completion_epoch_source: "completion_header",
}));
assert.equal(authoritative.completion_to_terminal_poll_start_ms, 50);
assert.equal(authoritative.terminal_observation_delay_ms, 60);
assert.equal(diagnosePollingSchedule([authoritative]).classification, "polling-schedule-dominated");

const negative = derivePollingSample(sample({
  client_terminal_observed_epoch_ms: 1_070,
  benchmark_server_completion_epoch_ms: 1_100,
  server_completion_epoch_source: "timing_diagnostics",
  poll_events: [{
    request_started_epoch_ms: 1_050,
    response_received_epoch_ms: 1_060,
    status: 500,
    terminal: true,
    request_round_trip_ms: 10,
    wait_before_request_ms: 0,
  }],
}));
assert.equal(negative.completion_to_terminal_poll_start_ms, null);
assert.equal(negative.completion_to_terminal_poll_start_raw_ms, -50);
assert.equal(negative.terminal_response_after_completion_ms, null);
assert.equal(negative.terminal_response_after_completion_raw_ms, -40);
assert.equal(negative.terminal_observation_delay_ms, null);
assert.equal(negative.terminal_observation_delay_raw_ms, -30);
assert.deepEqual(negative.invalid_epoch_deltas, [
  "terminal_response_after_completion",
  "completion_to_terminal_poll_start",
  "server_to_client_observation_delay",
]);
assert.equal(negative.invalid_epoch_delta_count, 3);

console.log("benchmark-tlsn-remote-analysis-test: ok");
