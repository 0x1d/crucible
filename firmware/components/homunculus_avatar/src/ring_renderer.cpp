#include "ring_renderer.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace homunculus::ring {

namespace {

constexpr float BASE_RADIUS = 0.30f;  // of min(w, h)
constexpr float DEFLECTION = 0.16f;   // of min(w, h), at full scale
constexpr float ATTACK_TAU = 0.060f;   // s; time constants, so smoothing is independent of frame rate
constexpr float RELEASE_TAU = 0.150f;
constexpr float ENV_FLOOR = 1500.0f;  // auto-gain never amplifies below this peak (int16)
constexpr float ENV_TAU = 0.95f;      // s: auto-gain release
constexpr float COLOUR_GAIN = 8.0f;  // |deflection| -> colour index
constexpr float PI = 3.14159265f;

uint32_t lerp_rgb(uint32_t a, uint32_t b, float t)
{
    auto ch = [&](int shift) {
        const float x = ((a >> shift) & 0xFF) * (1 - t) + ((b >> shift) & 0xFF) * t;
        return static_cast<uint32_t>(std::lround(x)) << shift;
    };
    return ch(16) | ch(8) | ch(0);
}

}  // namespace

uint16_t to_panel565(uint32_t rgb, float scale)
{
    auto ch = [&](int shift) {
        return static_cast<uint32_t>(std::min(255L, std::lround(((rgb >> shift) & 0xFF) * scale)));
    };
    const uint32_t r = ch(16), g = ch(8), b = ch(0);
    const uint16_t v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    return static_cast<uint16_t>((v >> 8) | (v << 8));
}

void Renderer::Span::add(int a, int b)
{
    if (empty()) {
        lo = a;
        hi = b;
    } else {
        lo = std::min(lo, a);
        hi = std::max(hi, b);
    }
}

Renderer::Renderer(int width, int height, uint8_t *intensity, uint8_t *colour, uint16_t *fb)
    : w_(width), h_(height), hw_(width / 2), bands_((height + BAND - 1) / BAND), intensity_(intensity),
      colour_(colour), fb_(fb), prev_(bands_), env_(ENV_FLOOR)
{
    const float m = static_cast<float>(std::min(width, height));
    r0_ = BASE_RADIUS * m;
    amp_ = DEFLECTION * m;
    cy_ = (height - 1) / 2.0f;
    for (int dy = -BRUSH_R; dy <= BRUSH_R; dy++) {
        for (int dx = -BRUSH_R; dx <= BRUSH_R; dx++) {
            const float d = std::sqrt(static_cast<float>(dx * dx + dy * dy));
            const float a = d <= 1.0f ? 1.0f : std::exp(-(d - 1.0f) * (d - 1.0f) / 1.6f);
            brush_[dy + BRUSH_R][dx + BRUSH_R] = d > BRUSH_R + 0.2f ? 0 : static_cast<uint8_t>(std::lround(255 * a));
        }
    }
}

void Renderer::set_palette(const Palette &p)
{
    for (int c = 0; c < COLOURS; c++) {
        const float t = static_cast<float>(c) / (COLOURS - 1);
        const uint32_t rgb = t < 0.5f ? lerp_rgb(p.stop[0], p.stop[1], t * 2) : lerp_rgb(p.stop[1], p.stop[2], t * 2 - 1);
        for (int l = 0; l < LEVELS; l++) {
            lut_[c][l] = to_panel565(rgb, p.brightness * l / (LEVELS - 1));
        }
    }
}

float Renderer::update(const int16_t *window, float gate, float dt)
{
    const float a_attack = 1 - std::exp(-dt / ATTACK_TAU), a_release = 1 - std::exp(-dt / RELEASE_TAU);
    float mean = 0, sq = 0, peak = 0;
    for (int i = 0; i < WINDOW; i++) mean += window[i];
    mean /= WINDOW;
    for (int i = 0; i < WINDOW; i++) {
        window_[i] = window[i] - mean;
        sq += window_[i] * window_[i];
        peak = std::max(peak, std::fabs(window_[i]));
    }
    const bool silent = std::sqrt(sq / WINDOW) < gate;
    env_ = std::max({peak, env_ * std::exp(-dt / ENV_TAU), ENV_FLOOR});

    float max_disp = 0;
    for (int k = 0; k < POINTS; k++) {
        float target = 0;
        if (!silent) {
            constexpr int step = WINDOW / POINTS;
            for (int j = 0; j < step; j++) target += window_[k * step + j];
            target = std::clamp(target / step / env_, -1.0f, 1.0f);
        }
        const float rate = std::fabs(target) > std::fabs(disp_[k]) ? a_attack : a_release;
        disp_[k] += (target - disp_[k]) * rate;
        max_disp = std::max(max_disp, std::fabs(disp_[k]));
    }
    if (silent && max_disp < 0.01f) {
        std::fill(std::begin(disp_), std::end(disp_), 0.0f);
        max_disp = 0;
    }
    return max_disp;
}

Rows Renderer::render()
{
    Rows dirty;
    // Right half, top (theta 0) to bottom (theta pi).
    for (int k = 0; k < POINTS; k++) {
        const float th = PI * k / (POINTS - 1);
        const float r = r0_ + amp_ * disp_[k];
        pts_[k] = {-0.5f + r * std::sin(th), cy_ - r * std::cos(th),
                   std::min<float>(COLOURS - 1, std::fabs(disp_[k]) * COLOUR_GAIN)};
    }

    for (int b = 0; b < bands_; b++) {
        const int y0 = b * BAND, rows = std::min(BAND, h_ - y0);
        Span cur;
        for (int k = 0; k + 1 < POINTS; k++) {
            const Point &p = pts_[k], &q = pts_[k + 1];
            if (std::max(p.y, q.y) + BRUSH_R + 1 < y0 || std::min(p.y, q.y) - BRUSH_R - 1 >= y0 + rows) continue;
            cur.add(std::max(0, static_cast<int>(std::floor(std::min(p.x, q.x))) - BRUSH_R - 1),
                    std::min(hw_ - 1, static_cast<int>(std::ceil(std::max(p.x, q.x))) + BRUSH_R + 1));
        }
        Span span = cur;
        if (!prev_[b].empty()) span.add(prev_[b].lo, prev_[b].hi);
        prev_[b] = cur;
        if (span.empty()) continue;

        stamp_band(y0, rows);
        write_span(span.lo, span.hi, y0, rows);
        if (dirty.y1 >= dirty.y2) dirty.y1 = y0;
        dirty.y2 = y0 + rows;
    }
    return dirty;
}

void Renderer::stamp_band(int y0, int rows)
{
    std::memset(intensity_, 0, BAND * hw_);
    std::memset(colour_, 0, BAND * hw_);
    for (int k = 0; k + 1 < POINTS; k++) {
        const Point &p = pts_[k], &q = pts_[k + 1];
        if (std::max(p.y, q.y) + BRUSH_R + 1 < y0 || std::min(p.y, q.y) - BRUSH_R - 1 >= y0 + rows) continue;
        const float len = std::hypot(q.x - p.x, q.y - p.y);
        const int steps = std::max(1, static_cast<int>(std::ceil(len / 1.5f)));
        const int last = k + 2 == POINTS ? steps : steps - 1;
        for (int s = 0; s <= last; s++) {
            const float t = static_cast<float>(s) / steps;
            const int ix = static_cast<int>(std::lround(p.x + (q.x - p.x) * t));
            const int iy = static_cast<int>(std::lround(p.y + (q.y - p.y) * t)) - y0;
            const auto ci = static_cast<uint8_t>(std::lround(p.c + (q.c - p.c) * t));
            for (int dy = -BRUSH_R; dy <= BRUSH_R; dy++) {
                const int yy = iy + dy;
                if (yy < 0 || yy >= rows) continue;
                for (int dx = -BRUSH_R; dx <= BRUSH_R; dx++) {
                    int u = ix + dx;
                    if (u < 0) u = -1 - u;  // reflected across the axis
                    if (u >= hw_) continue;
                    const uint8_t v = brush_[dy + BRUSH_R][dx + BRUSH_R];
                    uint8_t &dst = intensity_[yy * hw_ + u];
                    if (v > dst) {
                        dst = v;
                        colour_[yy * hw_ + u] = ci;
                    }
                }
            }
        }
    }
}

void Renderer::write_span(int lo, int hi, int y0, int rows)
{
    // Half-plane columns lo..hi map to screen columns hw+lo..hw+hi (right) and hw-1-hi..hw-1-lo (left).
    for (int yy = 0; yy < rows; yy++) {
        const uint8_t *in = intensity_ + yy * hw_, *ci = colour_ + yy * hw_;
        uint16_t *row = fb_ + (y0 + yy) * w_;
        for (int u = lo; u <= hi; u++) {
            const uint16_t px = in[u] ? lut_[ci[u]][in[u] >> 2] : 0;
            row[hw_ + u] = px;
            row[hw_ - 1 - u] = px;
        }
    }
}

}  // namespace homunculus::ring
