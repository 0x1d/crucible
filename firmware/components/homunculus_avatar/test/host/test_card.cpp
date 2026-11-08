// Card rasteriser host test; optional argument: PPM contact sheet path.
#include <cstdio>
#include <vector>
#include "card_renderer.hpp"

static int g_failures = 0;
#define CHECK(c, msg)                                          \
    do {                                                       \
        if (!(c)) {                                            \
            std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, msg); \
            g_failures++;                                      \
        }                                                      \
    } while (0)

using homunculus::card::wrap;

static void write_ppm(const char *path, const std::vector<std::vector<uint16_t>> &fbs, int w, int h)
{
    FILE *f = std::fopen(path, "wb");
    std::fprintf(f, "P6\n%d %d\n255\n", w * static_cast<int>(fbs.size()), h);
    for (int y = 0; y < h; y++) {
        for (const auto &fb : fbs) {
            for (int x = 0; x < w; x++) {
                const uint16_t v = fb[y * w + x];
                const uint16_t p = static_cast<uint16_t>((v >> 8) | (v << 8));
                const unsigned char rgb[3] = {static_cast<unsigned char>((p >> 11) << 3),
                                              static_cast<unsigned char>(((p >> 5) & 0x3F) << 2),
                                              static_cast<unsigned char>((p & 0x1F) << 3)};
                std::fwrite(rgb, 1, 3, f);
            }
        }
    }
    std::fclose(f);
}

int main(int argc, char **argv)
{
    auto l = wrap("Send message to Alex: running late, back soon", 20, 4);
    CHECK(l.size() == 3 && l[0] == "Send message to", "wrap words");
    for (const auto &s : l) CHECK(s.size() <= 20, "line width");
    l = wrap("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 10, 2);
    CHECK(l.size() == 2 && l[1].size() == 10 && l[1].substr(7) == "...", "long word split + ellipsis");
    l = wrap("a\nb\tc  d", 20, 2);
    CHECK(l.size() == 1 && l[0] == "a b c d", "control characters");
    CHECK(wrap("", 10, 2).empty(), "empty");
    CHECK(wrap("caf\xC3\xA9", 10, 1)[0] == "caf??", "non-ASCII");

    const int w = 466, h = 466;
    std::vector<uint16_t> a(w * h, 0xFFFF), b(w * h, 0xFFFF);
    homunculus::card::draw_confirm(a.data(), w, h, "Open the garage door?", "device.open_garage {\"door\":\"main\"}");
    homunculus::card::draw_text(b.data(), w, h, "Call 555 0199 for a table at 7 pm");
    auto lit = [&](const std::vector<uint16_t> &fb, int x0, int y0, int x1, int y1) {
        int n = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) n += fb[y * w + x] != 0;
        return n;
    };
    CHECK(lit(a, 0, 0, 5, 5) == 0, "framebuffer cleared");
    CHECK(lit(a, 60, 70, 400, 250) > 500, "confirm text drawn");
    CHECK(lit(a, 90, 330, 180, 410) > 4000 && lit(a, 290, 330, 380, 410) > 4000, "both buttons drawn");
    CHECK(lit(a, 215, 330, 250, 410) == 0, "gap between buttons");
    CHECK(lit(b, 60, 150, 400, 320) > 500 && lit(b, 90, 330, 380, 410) == 0, "text card");
    if (argc > 1) write_ppm(argv[1], {a, b}, w, h);
    std::printf("%d failures\n", g_failures);
    return g_failures ? 1 : 0;
}
