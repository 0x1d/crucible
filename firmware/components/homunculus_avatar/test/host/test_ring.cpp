// Host test for the ring rasteriser: flat ring geometry, mirror symmetry, CO5300 rectangle
// alignment, dirty-span clearing, and a PPM contact sheet (argv[1]) for visual review.
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "ring_renderer.hpp"

using namespace homunculus::ring;

namespace {

constexpr int W = 466, H = 466;

struct Screen {
    std::vector<uint16_t> px = std::vector<uint16_t>(W * H, 0);
    int rects = 0, pixels = 0;
    Renderer::Flush flush()
    {
        return [this](int x1, int y1, int x2, int y2, const uint16_t *p) {
            if (x1 % 2 || x2 % 2 || x1 < 0 || x2 > W || y1 < 0 || y2 > H || x2 <= x1 || y2 - y1 > BAND) {
                std::fprintf(stderr, "bad rect [%d,%d)x[%d,%d)\n", x1, x2, y1, y2);
                std::exit(1);
            }
            for (int y = y1; y < y2; y++)
                for (int x = x1; x < x2; x++) px[y * W + x] = *p++;
            rects++;
            pixels += (x2 - x1) * (y2 - y1);
        };
    }
    bool lit(int x, int y) const
    {
        return px[y * W + x] != 0;
    }
};

void check(bool ok, const char *what)
{
    if (!ok) {
        std::fprintf(stderr, "FAIL: %s\n", what);
        std::exit(1);
    }
    std::printf("ok: %s\n", what);
}

void speech_like(std::vector<int16_t> &w, float t0, float amp)
{
    for (int i = 0; i < WINDOW; i++) {
        const float t = t0 + i / 16000.0f;
        w[i] = static_cast<int16_t>(amp * (0.6f * std::sin(2 * 3.14159f * 180 * t) + 0.3f * std::sin(2 * 3.14159f * 720 * t) +
                                           0.1f * std::sin(2 * 3.14159f * 2100 * t)));
    }
}

void write_ppm(const char *path, const std::vector<Screen> &frames)
{
    FILE *f = std::fopen(path, "wb");
    const int n = static_cast<int>(frames.size());
    std::fprintf(f, "P6 %d %d 255\n", W * n, H);
    for (int y = 0; y < H; y++)
        for (int i = 0; i < n; i++)
            for (int x = 0; x < W; x++) {
                uint16_t v = frames[i].px[y * W + x];
                v = static_cast<uint16_t>((v >> 8) | (v << 8));
                const unsigned char rgb[3] = {static_cast<unsigned char>((v >> 11) << 3),
                                              static_cast<unsigned char>(((v >> 5) & 0x3F) << 2),
                                              static_cast<unsigned char>((v & 0x1F) << 3)};
                std::fwrite(rgb, 1, 3, f);
            }
    std::fclose(f);
}

}  // namespace

int main(int argc, char **argv)
{
    std::vector<uint8_t> intensity(BAND * W / 2), colour(BAND * W / 2);
    std::vector<uint16_t> tx(BAND * W);
    Renderer r(W, H, intensity.data(), colour.data(), tx.data());
    const Palette speaking{{0xc020e0, 0x6f8af6, 0xe9dbfc}, 1.0f};
    const Palette idle{{0x00a050, 0x40e080, 0xc0ffd0}, 0.45f};
    std::vector<int16_t> win(WINDOW, 0);
    const float gate = 32768.0f * std::pow(10.0f, -55 / 20.0f);
    std::vector<Screen> sheet;

    // Flat ring
    Screen s;
    r.set_palette(idle);
    check(r.update(win.data(), gate) == 0, "silence gives a flat ring");
    r.render(s.flush());
    const float r0 = 0.30f * W, c = (W - 1) / 2.0f;
    bool on_ring = true, symmetric = true, off_ring_dark = true;
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
            const float d = std::hypot(x - c, y - c);
            if (s.lit(x, y) != s.lit(W - 1 - x, y)) symmetric = false;
            if (s.lit(x, y) && std::fabs(d - r0) > BRUSH_R + 1.5f) off_ring_dark = false;
        }
    for (int a = 0; a < 360; a++) {
        const int x = static_cast<int>(std::lround(c + r0 * std::sin(a * 3.14159f / 180)));
        const int y = static_cast<int>(std::lround(c - r0 * std::cos(a * 3.14159f / 180)));
        if (!s.lit(x, y)) on_ring = false;
    }
    check(on_ring, "flat ring is closed at the base radius");
    check(off_ring_dark, "nothing drawn away from the ring");
    check(symmetric, "flat ring is mirror-symmetric");
    sheet.push_back(s);

    // Speech: deflection, symmetry, bounded radius
    r.set_palette(speaking);
    Screen sp = s;
    float t = 0;
    for (int f = 0; f < 8; f++, t += 1 / 30.0f) {
        speech_like(win, t, 8000);
        check(r.update(win.data(), gate) > 0.2f, "speech deflects the ring");
        r.render(sp.flush());
        if (f == 3 || f == 7) sheet.push_back(sp);
    }
    bool sym = true, inside = true;
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
            if (sp.lit(x, y) != sp.lit(W - 1 - x, y)) sym = false;
            const float d = std::hypot(x - c, y - c);
            if (sp.lit(x, y) && (d > 0.46f * W + BRUSH_R + 2 || d < 0.14f * W - BRUSH_R - 2)) inside = false;
        }
    check(sym, "speech frame is mirror-symmetric");
    check(inside, "deflection stays within base radius +- amplitude");
    std::printf("speech frame: %d rects, %d px flushed\n", sp.rects, sp.pixels);

    // Back to silence: old waveform fully erased
    std::fill(win.begin(), win.end(), 0);
    float m = 1;
    int frames = 0;
    while ((m = r.update(win.data(), gate)) > 0 && frames < 100) {
        r.render(sp.flush());
        frames++;
    }
    r.set_palette(idle);
    r.render(sp.flush());
    bool same = true;
    for (int i = 0; i < W * H; i++)
        if ((sp.px[i] != 0) != (s.px[i] != 0)) same = false;
    check(frames < 30, "ring relaxes within 1 s");
    check(same, "silence after speech restores the flat ring exactly");
    sheet.push_back(sp);

    // Steady flat ring flushes nothing new
    Screen idle_screen;
    r.render(idle_screen.flush());
    std::printf("flat redraw: %d rects, %d px\n", idle_screen.rects, idle_screen.pixels);

    if (argc > 1) write_ppm(argv[1], sheet);
    return 0;
}
