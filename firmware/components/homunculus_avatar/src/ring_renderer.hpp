// Circular waveform rasteriser (spec 06 §6.3): platform-independent, host-testable.
//
// The picture is mirror-symmetric about the vertical axis, so only the right half is
// rasterised: an intensity plane and a colour-index plane per band of BAND rows (stamps
// that cross the axis are reflected). Each band is converted through the palette LUT into
// byte-swapped RGB565 and flushed as one rectangle (or two: left and right arc) covering
// the union of this frame's and the previous frame's drawn columns. Rectangles start on
// an even column and have an even width (CO5300).
#pragma once

#include <cstdint>
#include <functional>
#include <vector>

namespace homunculus::ring {

constexpr int BAND = 10;     // rows per flush (Brookesia max transfer: 10 lines at 466 px)
constexpr int POINTS = 96;   // waveform points per half circle, top to bottom
constexpr int WINDOW = 480;  // samples per frame (30 ms at 16 kHz), POINTS * 5
constexpr int BRUSH_R = 3;   // stamp radius in px
constexpr int COLOURS = 8;   // colour index levels (base ring -> largest deflection)
constexpr int LEVELS = 64;   // intensity levels per colour

// Three colour stops (base ring -> largest deflection) and overall brightness.
struct Palette {
    uint32_t stop[3];
    float brightness;
};

// Byte-swapped RGB565 (panel byte order).
uint16_t to_panel565(uint32_t rgb, float scale);

class Renderer {
public:
    // [x1, x2) x [y1, y2) screen rectangle, row-major pixels of width x2 - x1.
    using Flush = std::function<void(int x1, int y1, int x2, int y2, const uint16_t *pixels)>;

    // Buffers: `intensity` and `colour` hold BAND * width / 2 bytes, `tx` BAND * width pixels.
    // Width must be even.
    Renderer(int width, int height, uint8_t *intensity, uint8_t *colour, uint16_t *tx);

    void set_palette(const Palette &p);

    // Updates the waveform from the last WINDOW samples; returns the largest |deflection|
    // (0 = flat ring). Below `gate` RMS the ring relaxes to flat.
    // `dt` is the time since the previous update in seconds (smoothing is time-based).
    float update(const int16_t *window, float gate, float dt = 1.0f / 30);

    // Renders the current waveform; only bands whose drawn columns changed are flushed.
    void render(const Flush &flush);

    int bands() const
    {
        return bands_;
    }

private:
    struct Span {
        int lo = 1, hi = 0;  // inclusive half-plane columns; empty when lo > hi
        bool empty() const
        {
            return lo > hi;
        }
        void add(int a, int b);
    };
    struct Point {
        float x, y;  // x in half-plane columns (axis at -0.5), y in screen rows
        float c;     // colour index
    };

    void stamp_band(int y0, int rows);
    void flush_rect(int x1, int x2, int y0, int rows, const Flush &flush);

    int w_, h_, hw_, bands_;
    float r0_, amp_, cy_;
    uint8_t *intensity_, *colour_;
    uint16_t *tx_;
    std::vector<Span> prev_;
    uint16_t lut_[COLOURS][LEVELS] = {};
    uint8_t brush_[2 * BRUSH_R + 1][2 * BRUSH_R + 1] = {};
    float disp_[POINTS] = {};
    float window_[WINDOW] = {};
    Point pts_[POINTS] = {};
    float env_;
};

}  // namespace homunculus::ring
