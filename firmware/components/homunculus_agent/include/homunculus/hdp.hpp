// HDP/1 codec (spec 04-device-protocol): binary audio frames (§4.3), device
// message builders (§4.4, §4.5) and server message parsing/validation.
// Platform independent (Boost.JSON only); covered by test/host against
// protocol/vectors.
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>
#include "boost/json.hpp"

namespace homunculus::hdp {

constexpr int VERSION = 1;
constexpr const char *SUBPROTOCOL = "hdp.v1";

// ---------------------------------------------------------------------------
// Binary audio frame (§4.3). All multi-byte integers big-endian.

constexpr uint8_t FRAME_OPUS_UPLINK = 0x01;
constexpr uint8_t FRAME_OPUS_DOWNLINK = 0x02;
constexpr uint8_t FRAME_PCM16 = 0x03;
constexpr uint8_t FLAG_FIRST = 0x01;
constexpr uint8_t FLAG_LAST = 0x02;
constexpr size_t FRAME_HEADER_BYTES = 10;
constexpr size_t FRAME_MAX_PAYLOAD = 0xFFFF;

struct Frame {
    uint8_t type = 0;
    uint8_t flags = 0;
    uint16_t stream_id = 0;
    uint32_t seq = 0;
    const uint8_t *payload = nullptr;  // points into the decoded buffer
    size_t payload_len = 0;
};

// Uplink flags for frame `seq` of a stream: bit0 on seq 0, bit1 on the last frame.
constexpr uint8_t stream_flags(uint32_t seq, bool last)
{
    return static_cast<uint8_t>((seq == 0 ? FLAG_FIRST : 0) | (last ? FLAG_LAST : 0));
}

// Writes the 10-byte header to `out`.
void write_frame_header(uint8_t *out, uint8_t type, uint8_t flags, uint16_t stream_id, uint32_t seq,
                        uint16_t payload_len);

// Header + payload; empty vector if the payload exceeds 65535 bytes.
std::vector<uint8_t> encode_frame(uint8_t type, uint8_t flags, uint16_t stream_id, uint32_t seq,
                                  const uint8_t *payload, size_t payload_len);

// Rejects short frames, unknown types and payload_len mismatches.
std::optional<Frame> decode_frame(const uint8_t *data, size_t len);

// ---------------------------------------------------------------------------
// Device → server messages

struct ToolDescriptor {
    std::string name;
    std::string description;
    boost::json::object input_schema;
};

struct HelloParams {
    std::string model;
    std::string firmware;
    std::string board;
    uint32_t display_width = 0;
    uint32_t display_height = 0;
    std::string display_shape;  // "round" | "rect"
    uint32_t color_depth = 16;
    std::vector<uint32_t> output_sample_rates;
    uint32_t mics = 1;
    bool aec = false;
    bool wake_word = false;
    std::vector<std::string> inputs;
    std::optional<bool> battery;
    std::string avatar_engine;
    std::vector<std::string> emotes;
    std::vector<ToolDescriptor> tools;
    std::string resume_session_id;  // empty: no resume
};

std::string make_hello(const HelloParams &p);
// mode: auto|manual|realtime; trigger: wake_word|touch|button|motion|follow_up; wake_word optional.
std::string make_listen_start(std::string_view mode, std::string_view trigger, std::string_view wake_word = {});
std::string make_listen_stop();
// reason: barge_in|user_cancel|wake_word
std::string make_abort(std::string_view reason);
std::string make_tts_played(uint32_t segment_id);
// JSON-RPC 2.0 response for a tool.call request id; exactly one of result / error.
std::string make_tool_result(const boost::json::value &id, const boost::json::value &result);
std::string make_tool_error(const boost::json::value &id, int code, std::string_view message);
// Answer to confirm.request (§4.5).
std::string make_confirm_result(std::string_view request_id, bool approved);
std::string make_goodbye(std::string_view reason);

// MCP tools/call result with a single text content item.
boost::json::value text_content(std::string_view text);

// ---------------------------------------------------------------------------
// Server → device messages

enum class ServerType {
    Hello,
    Listen,
    Stt,
    AgentStatus,
    Tts,
    Avatar,
    ToolCall,
    ConfirmRequest,
    Notify,
    Config,
    Error,
    Unknown,  // valid object with an unknown `type`: ignore (§4.9)
    Invalid,  // malformed JSON or schema mismatch
};

struct ServerMessage {
    ServerType type = ServerType::Invalid;
    std::string type_name;
    std::string error;          // Invalid: reason
    boost::json::object raw;    // the parsed object (unknown fields preserved)

    // hello
    std::string session_id;
    uint32_t sample_rate = 0;
    uint32_t channels = 0;
    uint32_t frame_ms = 0;
    std::string format;
    // listen / tts / avatar: state
    std::string state;
    // stt / tts / notify: text
    std::string text;
    bool final = false;
    // tts
    std::optional<uint32_t> segment_id;
    // agent.status
    std::string phase;
    std::string tool;
    // avatar
    std::string emote;
    // tool.call (JSON-RPC request)
    boost::json::value rpc_id;
    std::string method;
    std::string tool_name;
    boost::json::object arguments;
    // confirm.request
    std::string request_id;
    // error
    std::string code;
    std::string message;
};

ServerMessage parse_server_message(std::string_view text);

const char *to_string(ServerType type);

}  // namespace homunculus::hdp
