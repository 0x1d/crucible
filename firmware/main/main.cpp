// Homunculus Phase 0 bench (p0a / p0b):
//   - display: colour bars via the HAL panel interface
//   - touch:   logs touch points for the whole run
//   - audio:   AFE (AEC/NS/VAD/WakeNet) + Opus encode, then AFE + Opus encode
//              while decoding and playing back the recording (full duplex),
//              with per-task CPU load for each phase.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_pthread.h"
#define BROOKESIA_LOG_TAG "Bench"
#include "brookesia/lib_utils.hpp"
#include "brookesia/service_manager.hpp"
#include "brookesia/service_helper.hpp"
#include "brookesia/service_audio/service_audio.hpp"
#include "brookesia/hal_interface.hpp"
#include "brookesia/hal_adaptor.hpp"

using namespace esp_brookesia;
using AudioHelper = service::helper::Audio;
using AudioPlaybackHelper = service::helper::AudioPlayback;
using AudioEncoderHelper = service::helper::AudioEncoder<0>;
using AudioDecoderHelper = service::helper::AudioDecoder<0>;
using lib_utils::ThreadProfiler;

namespace {

constexpr int PHASE_SECONDS = 20;
constexpr const char *SOURCE_NAME = "Bench";
constexpr const char *OUTPUT_NAME = "Speaker0";

// Uplink format (spec §3.2.3): Opus, 16 kHz mono, 60 ms frames.
const AudioHelper::CodecGeneralConfig CODEC_GENERAL{
    .channels = 1,
    .sample_bits = 16,
    .sample_rate = 16000,
    .frame_duration = 60,
};

bool configure_audio_processor()
{
    hal::AudioProcessorConfig config{
        .playback = {
            .player_task = {
                .core_id = 0,
                .priority = 5,
                .stack_size = 4 * 1024,
#if CONFIG_SPIRAM_XIP_FROM_PSRAM
                .stack_in_ext = true,
#else
                .stack_in_ext = false,
#endif
            },
        },
        .encoder = {},
        .decoder = {},
        .afe = {
            .vad = hal::AudioProcessorAFE_VAD_Config{},
            .wakenet = hal::AudioProcessorAFE_WakeNetConfig{},
        },
    };
    return hal::AudioDevice::get_instance().set_processor_config(std::move(config));
}

// Acquired interfaces must stay alive: releasing the last handle deinitialises the device.
hal::InterfaceHandle<hal::display::PanelIface> g_panel;
hal::InterfaceHandle<hal::display::BacklightIface> g_backlight;

std::mutex g_draw_mutex;

// Paints the whole panel; colour_at(band) returns the RGB colour of vertical band 0..4.
template<typename F>
bool paint(F colour_at)
{
    auto &panel = g_panel;
    if (!panel) {
        return false;
    }
    const auto &info = panel->get_info();
    const uint32_t w = info.h_res, h = info.v_res;
    const uint32_t bytes_pp = info.get_pixel_bits() / 8;

    // Drawn in row bands so the line buffer stays small.
    std::lock_guard lock(g_draw_mutex);
    constexpr uint32_t BAND = 16;
    std::vector<uint8_t> buf(w * BAND * bytes_pp);
    for (uint32_t x = 0; x < w; x++) {
        const uint8_t *c = colour_at(x * 5 / w);
        for (uint32_t y = 0; y < BAND; y++) {
            uint8_t *p = &buf[(y * w + x) * bytes_pp];
            if (bytes_pp == 2) {
                uint16_t v = ((c[0] & 0xF8) << 8) | ((c[1] & 0xFC) << 3) | (c[2] >> 3);
                p[0] = v >> 8;  // panel expects big-endian RGB565
                p[1] = v & 0xFF;
            } else {
                p[0] = c[0];
                p[1] = c[1];
                p[2] = c[2];
            }
        }
    }
    bool ok = true;
    for (uint32_t y = 0; y < h; y += BAND) {
        ok &= panel->draw_bitmap(0, y, w, std::min(y + BAND, h), buf.data());
    }
    return ok;
}

constexpr uint8_t BARS[5][3] = {{255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255}, {0, 0, 0}};
constexpr uint8_t GREEN[3] = {0, 160, 0};
constexpr uint8_t BLUE[3] = {0, 60, 220};

void show_bars()
{
    bool ok = paint([](uint32_t band) {
        return BARS[std::min<uint32_t>(band, 4)];
    });
    BROOKESIA_LOGI("[display] colour bars: %1%", ok ? "ok" : "FAILED");
}

void show_colour(const uint8_t *c)
{
    paint([c](uint32_t) {
        return c;
    });
}

void init_display()
{
    g_panel = hal::acquire_first_interface<hal::display::PanelIface>();
    if (!g_panel) {
        BROOKESIA_LOGE("[display] no panel interface");
        return;
    }
    const auto &info = g_panel->get_info();
    BROOKESIA_LOGI("[display] %1%x%2%, %3% bits per pixel", info.h_res, info.v_res, info.get_pixel_bits());
    show_bars();

    g_backlight = hal::acquire_first_interface<hal::display::BacklightIface>();
    if (g_backlight) {
        g_backlight->set_brightness(80);
    }
}

std::atomic<bool> g_touch_run{true};

void touch_task()
{
    auto touch = hal::acquire_first_interface<hal::display::TouchIface>();
    if (!touch) {
        BROOKESIA_LOGE("[touch] no touch interface");
        return;
    }
    const auto &info = touch->get_info();
    BROOKESIA_LOGI("[touch] x_max=%1% y_max=%2% points=%3%", info.x_max, info.y_max, info.max_points);
    // The CST9217 only answers after asserting INT; polling it without a pending
    // interrupt returns ESP_ERR_INVALID_RESPONSE. Read on interrupt when supported.
    static std::atomic<bool> pending{false};
    const bool use_irq = info.operation_mode == hal::display::TouchIface::OperationMode::Interrupt &&
    touch->register_interrupt_handler([](void *) {
        pending = true;
        return false;
    }, nullptr);
    BROOKESIA_LOGI("[touch] mode: %1%", use_irq ? "interrupt" : "polling");
    std::vector<hal::display::TouchIface::Point> points;
    uint32_t errors = 0, touches = 0;
    bool was_down = false;
    while (g_touch_run) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
        if (use_irq && !pending.exchange(false) && !was_down) {
            continue;
        }
        points.clear();
        if (!touch->read_points(points)) {
            errors++;
            was_down = false;
            continue;
        }
        if (!points.empty() && !was_down) {
            touches++;
            BROOKESIA_LOGI("[touch] down at (%1%, %2%)", points[0].x, points[0].y);
        }
        was_down = !points.empty();
    }
    BROOKESIA_LOGI("[touch] summary: %1% touches, %2% read errors", touches, errors);
}

void print_heap(const char *label)
{
    BROOKESIA_LOGI(
        "[heap] %1%: internal free %2% KB (min %3% KB), PSRAM free %4% KB (min %5% KB)", label,
        heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024,
        heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL) / 1024,
        heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024, heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM) / 1024
    );
}

// Measures per-task CPU over the lifetime of the object.
class CpuWindow {
public:
    explicit CpuWindow(std::string label): label_(std::move(label)), start_(ThreadProfiler::sample_tasks()) {}
    ~CpuWindow()
    {
        auto end = ThreadProfiler::sample_tasks();
        if (!start_ || !end) {
            return;
        }
        auto snap = ThreadProfiler::take_snapshot(*start_, *end);
        if (!snap) {
            return;
        }
        BROOKESIA_LOGI("[cpu] ===== %1% (%2% ms) =====", label_, snap->stats.sample_duration_ms);
        ThreadProfiler::print_snapshot(*snap);
        // Core load = 100 - idle task share (the profiler reports percent of both cores).
        for (const auto &t : snap->tasks) {
            if (t.name == "IDLE0" || t.name == "IDLE1") {
                BROOKESIA_LOGI("[cpu] %1%: core load %2% %%", t.name == "IDLE0" ? "core0" : "core1",
                               100 - std::min<uint32_t>(100, t.cpu_percent * 2));
            }
        }
    }

private:
    std::string label_;
    std::shared_ptr<ThreadProfiler::SampleResult> start_;
};

bool start_encoder(bool opus)
{
    AudioHelper::EncoderDynamicConfig config{
        .type = opus ? AudioHelper::CodecFormat::OPUS : AudioHelper::CodecFormat::PCM,
        .general = CODEC_GENERAL,
        .enable_afe = true,
    };
    if (opus) {
        config.extra = AudioHelper::EncoderExtraConfigOpus{
            .enable_vbr = true,
            .bitrate = 24000,
        };
    }
    auto r = AudioEncoderHelper::call_function_sync(
                 AudioEncoderHelper::FunctionId::Start, BROOKESIA_DESCRIBE_TO_JSON(config).as_object(),
                 service::helper::Timeout(1000)
             );
    BROOKESIA_CHECK_FALSE_RETURN(r, false, "Failed to start encoder: %1%", r.error());
    return true;
}

bool stop_encoder()
{
    auto r = AudioEncoderHelper::call_function_sync(AudioEncoderHelper::FunctionId::Stop,
                                                    service::helper::Timeout(1000));
    BROOKESIA_CHECK_FALSE_RETURN(r, false, "Failed to stop encoder: %1%", r.error());
    return true;
}

// Plays Opus frames through the decoder; returns when drained.
bool play_opus(const std::vector<std::vector<uint8_t>> &frames)
{
    auto *decoder = service::AudioDecoder::get_instance(0);
    BROOKESIA_CHECK_NULL_RETURN(decoder, false, "AudioDecoder0 not available");

    std::mutex m;
    std::condition_variable cv;
    bool drained = false;
    lib_utils::scoped_connection drain_conn = decoder->connect_stream_drained(
    [&](const std::string & src, const std::string & out) {
        if (src == SOURCE_NAME && out == OUTPUT_NAME) {
            std::lock_guard lock(m);
            drained = true;
            cv.notify_all();
        }
    });

    (void)decoder->unregister_source(SOURCE_NAME);
    auto source = decoder->register_source(service::AudioSourceInfo{
        .name = SOURCE_NAME,
        .role = "bench",
        .preferred_outputs = {OUTPUT_NAME},
    });
    BROOKESIA_CHECK_FALSE_RETURN(source, false, "register_source: %1%", source.error());
    BROOKESIA_CHECK_FALSE_RETURN(decoder->request_output(source.value(), OUTPUT_NAME), false, "request_output");
    BROOKESIA_CHECK_FALSE_RETURN(decoder->set_active_source(OUTPUT_NAME, SOURCE_NAME), false, "set_active_source");
    auto opened = decoder->open_stream(source.value(), OUTPUT_NAME, service::AudioStreamConfig{
        .type = AudioHelper::CodecFormat::OPUS,
        .general = CODEC_GENERAL,
    });
    BROOKESIA_CHECK_FALSE_RETURN(opened, false, "open_stream: %1%", opened.error());

    for (const auto &f : frames) {
        auto w = decoder->write_stream(source.value(), OUTPUT_NAME, service::RawBuffer(f.data(), f.size()), 1000);
        BROOKESIA_CHECK_FALSE_RETURN(w == service::AudioWriteResult::Written, false, "write_stream failed");
    }
    {
        std::unique_lock lock(m);
        drained = drained || decoder->is_stream_drained(source.value(), OUTPUT_NAME);
        cv.wait_for(lock, std::chrono::seconds(PHASE_SECONDS + 10), [&] { return drained; });
    }
    (void)decoder->close_stream(source.value(), OUTPUT_NAME);
    (void)decoder->release_output(source.value(), OUTPUT_NAME);
    (void)decoder->unregister_source(source.value());
    return drained;
}

}  // namespace

extern "C" void app_main(void)
{
    BROOKESIA_LOGI("=== Homunculus Phase 0 bench ===");
    for (const char *tag : {"ESP_GMF_TASK", "ESP_GMF_PORT", "ESP_GMF_POOL", "GMF_AFE", "ESP_GMF_AENC", "AFE_MANAGER",
                            "AUD_RENDER", "AUDIO_PROCESSOR", "AUD_SDEC", "AFE_CONFIG", "NEW_DATA_BUS"}) {
        esp_log_level_set(tag, ESP_LOG_WARN);
    }
    print_heap("boot");

    BROOKESIA_CHECK_FALSE_EXIT(configure_audio_processor(), "Failed to configure audio processor");
    auto &service_manager = service::ServiceManager::get_instance();
    BROOKESIA_CHECK_FALSE_EXIT(service_manager.start(), "Failed to start ServiceManager");
    auto encoder_binding = service_manager.bind(AudioEncoderHelper::get_name().data());
    auto decoder_binding = service_manager.bind(AudioDecoderHelper::get_name().data());
    auto playback_binding = service_manager.bind(AudioPlaybackHelper::get_name().data());
    BROOKESIA_CHECK_FALSE_EXIT(encoder_binding.is_valid() && decoder_binding.is_valid() && playback_binding.is_valid(),
                               "Failed to bind audio");
    // Default output volume (75 %) is too quiet on the 1.75C speaker.
    auto vol = AudioPlaybackHelper::call_function_sync(AudioPlaybackHelper::FunctionId::SetVolume, 100.0);
    BROOKESIA_LOGI("[audio] volume 100 %%: %1%", vol ? "ok" : vol.error());

    init_display();
    auto pthread_cfg = esp_pthread_get_default_config();
    pthread_cfg.stack_size = 6 * 1024;
    pthread_cfg.thread_name = "touch";
    esp_pthread_set_cfg(&pthread_cfg);
    std::thread touch(touch_task);
    print_heap("services up");

    // Wake word / VAD events.
    std::atomic<uint32_t> afe_events = 0;
    auto afe_conn = AudioEncoderHelper::subscribe_event(
                        AudioEncoderHelper::EventId::AFEEventHappened,
    [&](const std::string & name, const std::string & event) {
        BROOKESIA_LOGI("[afe] event %1%: %2%", name, event);
        afe_events++;
        // Visual feedback: green = woken, blue = speech, bars = idle.
        const uint8_t *colour = nullptr;
        if (event == "WakeStart" || event == "VAD_End") {
            colour = GREEN;
        } else if (event == "VAD_Start") {
            colour = BLUE;
        }
        std::thread([colour] {
            colour ? show_colour(colour) : show_bars();
        }).detach();
    });
    auto words = AudioEncoderHelper::call_function_sync<boost::json::array>(
                     AudioEncoderHelper::FunctionId::GetAFEWakeWords
                 );
    BROOKESIA_LOGI("[afe] wake words: %1%", words ? boost::json::serialize(words.value()) : "error");

    // Collect encoded Opus frames.
    std::mutex frames_mutex;
    std::vector<std::vector<uint8_t>> frames;
    size_t encoded_bytes = 0;
    auto *encoder = service::AudioEncoder::get_instance(0);
    BROOKESIA_CHECK_NULL_EXIT(encoder, "AudioEncoder0 not available");
    lib_utils::scoped_connection enc_conn = encoder->connect_encoded_data([&](service::RawBuffer buf) {
        if (buf.data_ptr && buf.data_size > 0) {
            std::lock_guard lock(frames_mutex);
            frames.emplace_back(buf.data_ptr, buf.data_ptr + buf.data_size);
            encoded_bytes += buf.data_size;
        }
    });

    // Phase A: idle baseline (services up, nothing streaming).
    {
        CpuWindow w("A: idle");
        std::this_thread::sleep_for(std::chrono::seconds(5));
    }

    // Phase B: AFE + Opus encode (listening). Say "Computer" and talk.
    BROOKESIA_LOGI("[bench] phase B: AFE + Opus encode for %1% s - say \"Computer\", then speak", PHASE_SECONDS);
    BROOKESIA_CHECK_FALSE_EXIT(start_encoder(true), "encoder start");
    {
        CpuWindow w("B: AFE + Opus encode");
        std::this_thread::sleep_for(std::chrono::seconds(PHASE_SECONDS));
    }
    std::vector<std::vector<uint8_t>> recording;
    {
        std::lock_guard lock(frames_mutex);
        recording.swap(frames);
        BROOKESIA_LOGI("[bench] phase B: %1% frames, %2% bytes (%3% kbit/s), AFE events %4%", recording.size(),
                       encoded_bytes, encoded_bytes * 8 / 1000 / PHASE_SECONDS, afe_events.load());
    }
    print_heap("after B");

    // Phase C: full duplex - AFE + Opus encode keep running while the recording
    // is decoded and played (AEC reference active).
    BROOKESIA_LOGI("[bench] phase C: full duplex, playing back %1% frames", recording.size());
    {
        CpuWindow w("C: AFE + Opus encode + Opus decode/playback");
        bool ok = play_opus(recording);
        BROOKESIA_LOGI("[bench] playback %1%", ok ? "drained" : "FAILED/timeout");
    }
    BROOKESIA_CHECK_FALSE_EXIT(stop_encoder(), "encoder stop");
    print_heap("after C");

    g_touch_run = false;
    touch.join();
    BROOKESIA_LOGI("=== bench done: AFE events %1% ===", afe_events.load());
}
