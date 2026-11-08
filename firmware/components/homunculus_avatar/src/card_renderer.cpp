#include "card_renderer.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include "ring_renderer.hpp"

namespace homunculus::card {

namespace {

const uint8_t FONT[95][16] = {
#include "font8x16.inc"
};

constexpr int SCALE = 2;

class Canvas {
public:
    Canvas(uint16_t *fb, int w, int h) : fb_(fb), w_(w), h_(h) {}

    void clear()
    {
        std::memset(fb_, 0, static_cast<size_t>(w_) * h_ * 2);
    }

    void px(int x, int y, uint16_t c)
    {
        if (x >= 0 && x < w_ && y >= 0 && y < h_) fb_[y * w_ + x] = c;
    }

    void disc(int cx, int cy, int r, uint16_t c)
    {
        for (int y = -r; y <= r; y++) {
            for (int x = -r; x <= r; x++) {
                if (x * x + y * y <= r * r) px(cx + x, cy + y, c);
            }
        }
    }

    // Thick line: discs along the segment.
    void line(float x0, float y0, float x1, float y1, int r, uint16_t c)
    {
        const int n = std::max(1, static_cast<int>(std::hypot(x1 - x0, y1 - y0)));
        for (int i = 0; i <= n; i++) {
            const float t = static_cast<float>(i) / n;
            disc(static_cast<int>(std::lround(x0 + (x1 - x0) * t)), static_cast<int>(std::lround(y0 + (y1 - y0) * t)), r, c);
        }
    }

    void glyph(int x, int y, char ch, uint16_t c)
    {
        const uint8_t *g = FONT[(ch < 32 || ch > 126 ? '?' : ch) - 32];
        for (int row = 0; row < GLYPH_H; row++) {
            for (int col = 0; col < GLYPH_W; col++) {
                if (!(g[row] & (0x80 >> col))) continue;
                for (int dy = 0; dy < SCALE; dy++) {
                    for (int dx = 0; dx < SCALE; dx++) px(x + col * SCALE + dx, y + row * SCALE + dy, c);
                }
            }
        }
    }

    // Centred line of text with its top at `y`.
    void centred(int y, const std::string &s, uint16_t c)
    {
        const int width = static_cast<int>(s.size()) * GLYPH_W * SCALE;
        int x = (w_ - width) / 2;
        for (const char ch : s) {
            glyph(x, y, ch, c);
            x += GLYPH_W * SCALE;
        }
    }

private:
    uint16_t *fb_;
    int w_, h_;
};

uint16_t rgb(uint32_t v)
{
    return ring::to_panel565(v, 1.0f);
}

// Text columns that fit the chord of the circle at both ends of the text block.
int columns(int w)
{
    return std::max(8, static_cast<int>(w * 0.70f) / (GLYPH_W * SCALE));
}

}  // namespace

std::vector<std::string> wrap(const std::string &text, int max_cols, int max_lines)
{
    std::string clean;
    for (const char ch : text) {
        const auto u = static_cast<unsigned char>(ch);
        clean += u < 32 ? ' ' : u > 126 ? '?' : ch;
    }
    std::vector<std::string> lines;
    std::string line;
    bool dropped = false;
    size_t i = 0;
    while (i < clean.size()) {
        if (clean[i] == ' ') {
            i++;
            continue;
        }
        size_t j = clean.find(' ', i);
        if (j == std::string::npos) j = clean.size();
        std::string word = clean.substr(i, j - i);
        i = j;
        // Words longer than a line are split.
        while (static_cast<int>(word.size()) > max_cols) {
            if (!line.empty()) {
                lines.push_back(line);
                line.clear();
            }
            lines.push_back(word.substr(0, max_cols));
            word.erase(0, max_cols);
        }
        if (!line.empty() && static_cast<int>(line.size() + 1 + word.size()) > max_cols) {
            lines.push_back(line);
            line.clear();
        }
        line += (line.empty() ? "" : " ") + word;
    }
    if (!line.empty()) lines.push_back(line);
    if (static_cast<int>(lines.size()) > max_lines) {
        lines.resize(max_lines);
        dropped = true;
    }
    if (dropped) {
        std::string &last = lines.back();
        if (static_cast<int>(last.size()) + 3 > max_cols) last.resize(max_cols - 3);
        last += "...";
    }
    return lines;
}

void draw_confirm(uint16_t *fb, int w, int h, const std::string &title, const std::string &detail)
{
    Canvas c(fb, w, h);
    c.clear();
    const int m = std::min(w, h);
    const int cols = columns(w);
    int y = static_cast<int>(m * 0.17f);
    for (const auto &l : wrap(title, cols, 2)) {
        c.centred(y, l, rgb(0xFFFFFF));
        y += GLYPH_H * SCALE + 4;
    }
    y += 10;
    for (const auto &l : wrap(detail, cols, 4)) {
        c.centred(y, l, rgb(0xA8B0B8));
        y += GLYPH_H * SCALE + 2;
    }

    const int cy = static_cast<int>(m * 0.80f), dx = static_cast<int>(m * 0.18f), r = static_cast<int>(m * 0.115f);
    const int dcx = w / 2 - dx, acx = w / 2 + dx;
    const uint16_t white = rgb(0xFFFFFF);
    c.disc(dcx, cy, r, rgb(0xC62828));
    const float k = r * 0.38f;
    c.line(dcx - k, cy - k, dcx + k, cy + k, 3, white);
    c.line(dcx - k, cy + k, dcx + k, cy - k, 3, white);
    c.disc(acx, cy, r, rgb(0x2E9E4F));
    c.line(acx - k, cy, acx - k * 0.25f, cy + k * 0.8f, 3, white);
    c.line(acx - k * 0.25f, cy + k * 0.8f, acx + k, cy - k * 0.8f, 3, white);
}

void draw_text(uint16_t *fb, int w, int h, const std::string &text)
{
    Canvas c(fb, w, h);
    c.clear();
    const auto lines = wrap(text, columns(w), 8);
    const int lh = GLYPH_H * SCALE + 4;
    int y = (h - static_cast<int>(lines.size()) * lh) / 2;
    for (const auto &l : lines) {
        c.centred(y, l, rgb(0xFFFFFF));
        y += lh;
    }
}

}  // namespace homunculus::card
