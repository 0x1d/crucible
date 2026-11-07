// Host test of the HDP/1 codec against the shared vectors in protocol/vectors.
// Build and run: test/host/run.sh
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include "boost/json/src.hpp"
#include "homunculus/hdp.hpp"

namespace json = boost::json;
using namespace homunculus;

static int g_failures = 0;
static int g_checks = 0;

#define CHECK(cond, ...) do { \
    g_checks++; \
    if (!(cond)) { \
        g_failures++; \
        std::printf("FAIL %s:%d: %s: ", __FILE__, __LINE__, #cond); \
        std::printf(__VA_ARGS__); \
        std::printf("\n"); \
    } \
} while (0)

static json::value load(const std::string &path)
{
    std::ifstream f(path);
    if (!f) {
        std::printf("cannot open %s\n", path.c_str());
        std::exit(2);
    }
    std::stringstream ss;
    ss << f.rdbuf();
    return json::parse(ss.str());
}

static std::vector<uint8_t> from_hex(std::string_view hex)
{
    std::vector<uint8_t> out;
    for (size_t i = 0; i + 1 < hex.size(); i += 2) {
        out.push_back(static_cast<uint8_t>(std::stoi(std::string(hex.substr(i, 2)), nullptr, 16)));
    }
    return out;
}

static void test_frames(const json::object &v)
{
    for (const auto &item : v.at("valid").as_array()) {
        const auto &o = item.as_object();
        std::string name(o.at("name").as_string());
        auto bytes = from_hex(o.at("hex").as_string());
        auto f = hdp::decode_frame(bytes.data(), bytes.size());
        CHECK(f.has_value(), "valid frame '%s' rejected", name.c_str());
        if (!f) {
            continue;
        }
        auto payload = from_hex(o.at("payload_hex").as_string());
        CHECK(f->type == o.at("type").to_number<int>(), "%s: type", name.c_str());
        CHECK(f->flags == o.at("flags").to_number<int>(), "%s: flags", name.c_str());
        CHECK(f->stream_id == o.at("stream_id").to_number<uint32_t>(), "%s: stream_id", name.c_str());
        CHECK(f->seq == o.at("seq").to_number<uint32_t>(), "%s: seq", name.c_str());
        CHECK(std::vector<uint8_t>(f->payload, f->payload + f->payload_len) == payload, "%s: payload",
              name.c_str());
        auto enc = hdp::encode_frame(f->type, f->flags, f->stream_id, f->seq, payload.data(), payload.size());
        CHECK(enc == bytes, "%s: re-encode differs", name.c_str());
    }
    for (const auto &item : v.at("invalid").as_array()) {
        const auto &o = item.as_object();
        auto bytes = from_hex(o.at("hex").as_string());
        CHECK(!hdp::decode_frame(bytes.data(), bytes.size()).has_value(), "invalid frame '%s' accepted",
              std::string(o.at("name").as_string()).c_str());
    }
    std::vector<uint8_t> big(hdp::FRAME_MAX_PAYLOAD + 1);
    CHECK(hdp::encode_frame(1, 0, 0, 0, big.data(), big.size()).empty(), "oversized payload encoded");
}

static void test_server(const json::object &v)
{
    for (const auto &item : v.at("valid").as_array()) {
        auto text = json::serialize(item);
        auto m = hdp::parse_server_message(text);
        CHECK(m.type != hdp::ServerType::Invalid && m.type != hdp::ServerType::Unknown,
              "valid server message rejected: %s (%s)", text.c_str(), m.error.c_str());
        CHECK(m.type_name == hdp::to_string(m.type), "type mismatch for %s", text.c_str());
    }
    for (const auto &item : v.at("invalid").as_array()) {
        auto text = json::serialize(item);
        auto m = hdp::parse_server_message(text);
        CHECK(m.type == hdp::ServerType::Invalid, "invalid server message accepted: %s", text.c_str());
    }
    for (const auto &item : v.at("unknown").as_array()) {
        auto text = json::serialize(item);
        auto m = hdp::parse_server_message(text);
        CHECK(m.type == hdp::ServerType::Unknown, "unknown server message not ignored: %s", text.c_str());
    }
    CHECK(hdp::parse_server_message("{not json").type == hdp::ServerType::Invalid, "malformed JSON");
    CHECK(hdp::parse_server_message("[1]").type == hdp::ServerType::Invalid, "array");

    // Field extraction.
    auto hello = hdp::parse_server_message(json::serialize(v.at("valid").as_array().at(0)));
    CHECK(hello.session_id == "s_01JC0000000000000000000000", "session_id");
    CHECK(hello.sample_rate == 24000 && hello.frame_ms == 60 && hello.channels == 1, "downlink params");
    auto call = hdp::parse_server_message(
                    R"({"type":"tool.call","payload":{"jsonrpc":"2.0","id":3,"method":"tools/call",)"
                    R"("params":{"name":"device.set_volume","arguments":{"level":40}}},"extra":1})");
    CHECK(call.type == hdp::ServerType::ToolCall, "tool.call");
    CHECK(call.rpc_id == json::value(3) && call.method == "tools/call" && call.tool_name == "device.set_volume",
          "tool.call fields");
    CHECK(call.arguments.at("level").to_number<int>() == 40, "tool.call arguments");
    auto seg = hdp::parse_server_message(R"({"type":"tts","state":"segment_start","segment_id":1,"text":"Hi"})");
    CHECK(seg.segment_id && *seg.segment_id == 1 && seg.text == "Hi", "tts fields");
}

static bool same(const std::string &built, const json::value &expected)
{
    return json::parse(built) == expected;
}

static void test_device(const json::object &v)
{
    const auto &valid = v.at("valid").as_array();
    const auto &vh = valid.at(0).as_object();
    const auto &caps = vh.at("capabilities").as_object();
    const auto &audio = caps.at("audio").as_object();

    hdp::HelloParams p;
    p.model = "ws-s3-amoled-175c";
    p.firmware = "0.1.0";
    p.board = "waveshare/esp32_s3_touch_amoled_1_75c";
    p.display_width = 466;
    p.display_height = 466;
    p.display_shape = "round";
    p.output_sample_rates = {16000, 24000};
    p.mics = audio.at("mics").to_number<uint32_t>();
    p.aec = true;
    p.wake_word = true;
    p.inputs = {"touch", "button", "imu"};
    p.battery = true;
    p.avatar_engine = "homunculus-face/1";
    for (const auto &e : caps.at("avatar").at("emotes").as_array()) {
        p.emotes.emplace_back(e.as_string());
    }
    const auto &tool = vh.at("tools").as_array().at(0).as_object();
    p.tools.push_back({"device.set_volume", "Set speaker volume", tool.at("inputSchema").as_object()});
    p.resume_session_id = "s_01JC0000000000000000000000";
    auto hello = hdp::make_hello(p);
    CHECK(same(hello, valid.at(0)), "hello differs: %s", hello.c_str());

    CHECK(same(hdp::make_listen_start("auto", "wake_word", "computer"), valid.at(2)), "listen start");
    CHECK(same(hdp::make_listen_stop(), valid.at(3)), "listen stop");
    CHECK(same(hdp::make_abort("barge_in"), valid.at(4)), "abort");
    CHECK(same(hdp::make_tts_played(1), valid.at(5)), "tts.played");
    CHECK(same(hdp::make_tool_result(3, hdp::text_content("ok")), valid.at(6)), "tool.result");
    CHECK(same(hdp::make_tool_error("t-4", -32602, "level out of range"), valid.at(7)), "tool.result error");
    CHECK(same(hdp::make_goodbye("power_off"), valid.at(10)), "goodbye");
    auto touch = json::parse(hdp::make_listen_start("auto", "touch"));
    CHECK(!touch.as_object().contains("wake_word"), "listen start without wake word");
}

int main(int argc, char **argv)
{
    std::string dir = argc > 1 ? argv[1] : "../../../../../protocol/vectors";
    auto frames = load(dir + "/frames.json");
    auto messages = load(dir + "/messages.json");
    test_frames(frames.as_object());
    test_server(messages.at("server").as_object());
    test_device(messages.at("device").as_object());
    std::printf("%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
