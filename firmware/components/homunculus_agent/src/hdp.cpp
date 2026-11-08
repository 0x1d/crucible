// HDP/1 codec, see hdp.hpp. Validation mirrors protocol/src/messages.ts.
#include "homunculus/hdp.hpp"

#include <cmath>
#include <initializer_list>

namespace homunculus::hdp {

namespace json = boost::json;

// ---------------------------------------------------------------------------
// Frames

void write_frame_header(uint8_t *out, uint8_t type, uint8_t flags, uint16_t stream_id, uint32_t seq,
                        uint16_t payload_len)
{
    out[0] = type;
    out[1] = flags;
    out[2] = static_cast<uint8_t>(stream_id >> 8);
    out[3] = static_cast<uint8_t>(stream_id);
    out[4] = static_cast<uint8_t>(seq >> 24);
    out[5] = static_cast<uint8_t>(seq >> 16);
    out[6] = static_cast<uint8_t>(seq >> 8);
    out[7] = static_cast<uint8_t>(seq);
    out[8] = static_cast<uint8_t>(payload_len >> 8);
    out[9] = static_cast<uint8_t>(payload_len);
}

std::vector<uint8_t> encode_frame(uint8_t type, uint8_t flags, uint16_t stream_id, uint32_t seq,
                                  const uint8_t *payload, size_t payload_len)
{
    if (payload_len > FRAME_MAX_PAYLOAD) {
        return {};
    }
    std::vector<uint8_t> out(FRAME_HEADER_BYTES + payload_len);
    write_frame_header(out.data(), type, flags, stream_id, seq, static_cast<uint16_t>(payload_len));
    if (payload_len > 0) {
        std::copy(payload, payload + payload_len, out.begin() + FRAME_HEADER_BYTES);
    }
    return out;
}

std::optional<Frame> decode_frame(const uint8_t *data, size_t len)
{
    if (data == nullptr || len < FRAME_HEADER_BYTES) {
        return std::nullopt;
    }
    Frame f;
    f.type = data[0];
    if (f.type != FRAME_OPUS_UPLINK && f.type != FRAME_OPUS_DOWNLINK && f.type != FRAME_PCM16) {
        return std::nullopt;
    }
    f.flags = data[1];
    f.stream_id = static_cast<uint16_t>((data[2] << 8) | data[3]);
    f.seq = (static_cast<uint32_t>(data[4]) << 24) | (static_cast<uint32_t>(data[5]) << 16) |
            (static_cast<uint32_t>(data[6]) << 8) | data[7];
    f.payload_len = static_cast<size_t>((data[8] << 8) | data[9]);
    if (len != FRAME_HEADER_BYTES + f.payload_len) {
        return std::nullopt;
    }
    f.payload = data + FRAME_HEADER_BYTES;
    return f;
}

// ---------------------------------------------------------------------------
// Device messages

namespace {

json::array to_array(const std::vector<std::string> &v)
{
    json::array a;
    for (const auto &s : v) {
        a.emplace_back(s);
    }
    return a;
}

}  // namespace

std::string make_hello(const HelloParams &p)
{
    json::object device{{"model", p.model}, {"firmware", p.firmware}};
    if (!p.board.empty()) {
        device["board"] = p.board;
    }

    json::array rates;
    for (auto r : p.output_sample_rates) {
        rates.emplace_back(r);
    }
    json::object audio{
        {"input", {{"format", "opus"}, {"sample_rate", 16000}, {"channels", 1}, {"frame_ms", 60}}},
        {"output", {{"formats", json::array{"opus"}}, {"sample_rates", std::move(rates)}}},
        {"mics", p.mics},
        {"aec", p.aec},
        {"wake_word", p.wake_word},
    };
    json::object caps{{"audio", std::move(audio)}};
    if (p.display_width > 0) {
        caps["display"] = json::object{{"width", p.display_width}, {"height", p.display_height},
            {"shape", p.display_shape}, {"color_depth", p.color_depth}};
    }
    if (!p.inputs.empty()) {
        caps["input"] = to_array(p.inputs);
    }
    if (p.battery) {
        caps["power"] = json::object{{"battery", *p.battery}};
    }
    if (!p.avatar_engine.empty()) {
        caps["avatar"] = json::object{{"engine", p.avatar_engine}, {"emotes", to_array(p.emotes)}};
    }

    json::object hello{
        {"type", "hello"},
        {"version", VERSION},
        {"device", std::move(device)},
        {"capabilities", std::move(caps)},
    };
    if (!p.tools.empty()) {
        json::array tools;
        for (const auto &t : p.tools) {
            tools.emplace_back(json::object{{"name", t.name}, {"description", t.description},
                {"inputSchema", t.input_schema}});
        }
        hello["tools"] = std::move(tools);
    }
    if (!p.resume_session_id.empty()) {
        hello["resume"] = json::object{{"session_id", p.resume_session_id}};
    }
    return json::serialize(hello);
}

std::string make_listen_start(std::string_view mode, std::string_view trigger, std::string_view wake_word)
{
    json::object m{{"type", "listen"}, {"state", "start"}, {"mode", mode}, {"trigger", trigger}};
    if (!wake_word.empty()) {
        m["wake_word"] = wake_word;
    }
    return json::serialize(m);
}

std::string make_listen_stop()
{
    return json::serialize(json::object{{"type", "listen"}, {"state", "stop"}});
}

std::string make_abort(std::string_view reason)
{
    return json::serialize(json::object{{"type", "abort"}, {"reason", reason}});
}

std::string make_tts_played(uint32_t segment_id)
{
    return json::serialize(json::object{{"type", "tts.played"}, {"segment_id", segment_id}});
}

std::string make_tool_result(const json::value &id, const json::value &result)
{
    return json::serialize(json::object{
        {"type", "tool.result"},
        {"payload", {{"jsonrpc", "2.0"}, {"id", id}, {"result", result}}},
    });
}

std::string make_tool_error(const json::value &id, int code, std::string_view message)
{
    return json::serialize(json::object{
        {"type", "tool.result"},
        {"payload", {{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", code}, {"message", message}}}}},
    });
}

std::string make_confirm_result(std::string_view request_id, bool approved)
{
    return json::serialize(json::object{{"type", "confirm.result"}, {"request_id", request_id}, {"approved", approved}});
}

std::string make_goodbye(std::string_view reason)
{
    return json::serialize(json::object{{"type", "goodbye"}, {"reason", reason}});
}

json::value text_content(std::string_view text)
{
    return json::object{{"content", json::array{json::object{{"type", "text"}, {"text", text}}}}};
}

// ---------------------------------------------------------------------------
// Server messages

namespace {

// Field checks; each returns false and sets `err` on mismatch.
struct Checker {
    const json::object &o;
    std::string &err;

    bool fail(std::string_view field, std::string_view what)
    {
        err = std::string(field) + " " + std::string(what);
        return false;
    }

    static std::optional<int64_t> as_int(const json::value &v)
    {
        if (v.is_int64()) {
            return v.get_int64();
        }
        if (v.is_uint64()) {
            return v.get_uint64() > static_cast<uint64_t>(INT64_MAX) ? std::nullopt
                   : std::optional<int64_t>(static_cast<int64_t>(v.get_uint64()));
        }
        if (v.is_double()) {
            double d = v.get_double();
            if (std::isfinite(d) && std::floor(d) == d && std::fabs(d) < 9.0e15) {
                return static_cast<int64_t>(d);
            }
        }
        return std::nullopt;
    }

    static std::optional<double> as_number(const json::value &v)
    {
        if (v.is_number()) {
            return v.to_number<double>();
        }
        return std::nullopt;
    }

    bool str(const char *k, std::string *out, bool required = true, size_t min_len = 0)
    {
        auto *v = o.if_contains(k);
        if (!v) {
            return required ? fail(k, "is required") : true;
        }
        if (!v->is_string()) {
            return fail(k, "must be a string");
        }
        if (v->get_string().size() < min_len) {
            return fail(k, "is too short");
        }
        if (out) {
            *out = std::string(v->get_string());
        }
        return true;
    }

    bool enumeration(const char *k, std::initializer_list<const char *> values, std::string *out,
                     bool required = true)
    {
        std::string s;
        if (!str(k, &s, required)) {
            return false;
        }
        if (!o.contains(k)) {
            return true;
        }
        for (auto *v : values) {
            if (s == v) {
                if (out) {
                    *out = s;
                }
                return true;
            }
        }
        return fail(k, "has an unknown value");
    }

    bool uint(const char *k, std::optional<uint32_t> *out, bool required = true, int64_t min = 0)
    {
        auto *v = o.if_contains(k);
        if (!v) {
            return required ? fail(k, "is required") : true;
        }
        auto i = as_int(*v);
        if (!i || *i < min || *i > UINT32_MAX) {
            return fail(k, "must be an integer >= " + std::to_string(min));
        }
        if (out) {
            *out = static_cast<uint32_t>(*i);
        }
        return true;
    }

    bool boolean(const char *k, bool *out, bool required = true)
    {
        auto *v = o.if_contains(k);
        if (!v) {
            return required ? fail(k, "is required") : true;
        }
        if (!v->is_bool()) {
            return fail(k, "must be a boolean");
        }
        if (out) {
            *out = v->get_bool();
        }
        return true;
    }

    bool number(const char *k, double min, double max, bool required = true)
    {
        auto *v = o.if_contains(k);
        if (!v) {
            return required ? fail(k, "is required") : true;
        }
        auto d = as_number(*v);
        if (!d || *d < min || *d > max) {
            return fail(k, "out of range");
        }
        return true;
    }

    const json::object *object(const char *k, bool required = true)
    {
        auto *v = o.if_contains(k);
        if (!v) {
            if (required) {
                fail(k, "is required");
            }
            return nullptr;
        }
        if (!v->is_object()) {
            fail(k, "must be an object");
            return nullptr;
        }
        return &v->get_object();
    }
};

bool check_session_config(const json::object &c, std::string &err)
{
    Checker k{c, err};
    return k.uint("follow_up_window_ms", nullptr, false) && k.boolean("captions", nullptr, false) &&
           k.str("language", nullptr, false);
}

bool parse_typed(ServerMessage &m, std::string &err)
{
    const auto &o = m.raw;
    Checker k{o, err};
    const auto &t = m.type_name;

    if (t == "hello") {
        m.type = ServerType::Hello;
        if (!k.str("session_id", &m.session_id, true, 1)) {
            return false;
        }
        auto *audio = k.object("audio");
        if (!audio) {
            return false;
        }
        Checker ka{*audio, err};
        auto *output = ka.object("output");
        if (!output) {
            return false;
        }
        Checker ko{*output, err};
        std::optional<uint32_t> rate, channels, frame_ms;
        if (!ko.enumeration("format", {"opus", "pcm16"}, &m.format) || !ko.uint("sample_rate", &rate) ||
                !ko.uint("channels", &channels, true, 1) || !ko.uint("frame_ms", &frame_ms, true, 1)) {
            return false;
        }
        m.sample_rate = *rate;
        m.channels = *channels;
        m.frame_ms = *frame_ms;
        auto *config = k.object("config");
        return config && check_session_config(*config, err);
    }
    if (t == "listen") {
        m.type = ServerType::Listen;
        return k.enumeration("state", {"stop"}, &m.state);
    }
    if (t == "stt") {
        m.type = ServerType::Stt;
        return k.str("text", &m.text) && k.boolean("final", &m.final);
    }
    if (t == "agent.status") {
        m.type = ServerType::AgentStatus;
        return k.enumeration("phase", {"thinking", "tool", "responding", "done", "error"}, &m.phase) &&
               k.str("tool", &m.tool, false) && k.str("detail", nullptr, false);
    }
    if (t == "tts") {
        m.type = ServerType::Tts;
        return k.enumeration("state", {"start", "segment_start", "segment_end", "stop"}, &m.state) &&
               k.uint("segment_id", &m.segment_id, false) && k.str("text", &m.text, false);
    }
    if (t == "avatar") {
        m.type = ServerType::Avatar;
        if (!k.enumeration("state", {"idle", "listening", "thinking", "working", "speaking", "confirming",
                                     "sleeping", "offline", "error"}, &m.state, false) ||
                !k.str("emote", &m.emote, false) || !k.number("intensity", 0, 1, false) ||
                !k.uint("duration_ms", nullptr, false)) {
            return false;
        }
        if (o.contains("gaze")) {
            auto *gaze = k.object("gaze");
            if (!gaze) {
                return false;
            }
            Checker kg{*gaze, err};
            return kg.number("x", -1, 1) && kg.number("y", -1, 1);
        }
        return true;
    }
    if (t == "tool.call") {
        m.type = ServerType::ToolCall;
        auto *p = k.object("payload");
        if (!p) {
            return false;
        }
        Checker kp{*p, err};
        if (!kp.enumeration("jsonrpc", {"2.0"}, nullptr) || !kp.str("method", &m.method)) {
            return false;
        }
        auto *id = p->if_contains("id");
        if (!id || !(id->is_string() || Checker::as_int(*id))) {
            return kp.fail("payload.id", "must be a string or integer");
        }
        m.rpc_id = *id;
        if (auto *params = p->if_contains("params"); params && params->is_object()) {
            const auto &po = params->get_object();
            if (auto *n = po.if_contains("name"); n && n->is_string()) {
                m.tool_name = std::string(n->get_string());
            }
            if (auto *a = po.if_contains("arguments"); a && a->is_object()) {
                m.arguments = a->get_object();
            }
        }
        return true;
    }
    if (t == "confirm.request") {
        m.type = ServerType::ConfirmRequest;
        std::optional<uint32_t> timeout;
        const bool ok = k.str("request_id", &m.request_id) && k.str("title", &m.title) && k.str("detail", &m.detail) &&
               k.uint("timeout_ms", &timeout);
        m.timeout_ms = timeout.value_or(0);
        return ok;
    }
    if (t == "notify") {
        m.type = ServerType::Notify;
        return k.str("text", &m.text) && k.enumeration("level", {"info", "warning", "alert"}, nullptr);
    }
    if (t == "config") {
        m.type = ServerType::Config;
        auto *c = k.object("config");
        return c && check_session_config(*c, err);
    }
    if (t == "error") {
        m.type = ServerType::Error;
        return k.enumeration("code", {"unsupported_version", "unauthorized", "hello_required", "bad_message",
                                      "busy", "internal"}, &m.code) &&
               k.str("message", &m.message);
    }
    m.type = ServerType::Unknown;
    return true;
}

}  // namespace

ServerMessage parse_server_message(std::string_view text)
{
    ServerMessage m;
    boost::system::error_code ec;
    json::value v = json::parse(json::string_view(text.data(), text.size()), ec);
    if (ec) {
        m.error = "malformed JSON: " + ec.message();
        return m;
    }
    if (!v.is_object()) {
        m.error = "message is not a JSON object";
        return m;
    }
    m.raw = std::move(v.get_object());
    auto *type = m.raw.if_contains("type");
    if (!type || !type->is_string()) {
        m.error = "missing string field 'type'";
        return m;
    }
    m.type_name = std::string(type->get_string());
    std::string err;
    if (!parse_typed(m, err)) {
        m.type = ServerType::Invalid;
        m.error = m.type_name + ": " + err;
    }
    return m;
}

const char *to_string(ServerType type)
{
    switch (type) {
    case ServerType::Hello: return "hello";
    case ServerType::Listen: return "listen";
    case ServerType::Stt: return "stt";
    case ServerType::AgentStatus: return "agent.status";
    case ServerType::Tts: return "tts";
    case ServerType::Avatar: return "avatar";
    case ServerType::ToolCall: return "tool.call";
    case ServerType::ConfirmRequest: return "confirm.request";
    case ServerType::Notify: return "notify";
    case ServerType::Config: return "config";
    case ServerType::Error: return "error";
    case ServerType::Unknown: return "unknown";
    case ServerType::Invalid: return "invalid";
    }
    return "?";
}

}  // namespace homunculus::hdp
