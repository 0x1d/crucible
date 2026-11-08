// Circular waveform rasteriser (spec 06 §6.3): platform-independent, host-testable.
//
// The picture is mirror-symmetric about the vertical axis, so only the right half is
// rasterised: an intensity plane and a colour-index plane per band of BAND rows (stamps
// that cross the axis are reflected). Each band's changed columns (union of this frame's
// and the previous frame's drawn columns) are converted through the palette LUT into
// byte-swapped RGB565 in a full framebuffer; render() returns the changed rows, which the
// caller sends to the panel as one full-width transfer.
#pragma once

#include <cstdint>
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

// Changed rows [y1, y2); empty when y1 >= y2.
struct Rows {
    int y1 = 0, y2 = 0;
};

class Renderer {
public:
    // Buffers: `intensity` and `colour` hold BAND * width / 2 bytes; `fb` is the width x height
    // framebuffer (byte-swapped RGB565), initially black. Width must be even.
    Renderer(int width, int height, uint8_t *intensity, uint8_t *colour, uint16_t *fb);

    void set_palette(const Palette &p);

    // Updates the waveform from the last WINDOW samples; returns the largest |deflection|
    // (0 = flat ring). Below `gate` RMS the ring relaxes to flat.
    // `dt` is the time since the previous update in seconds (smoothing is time-based).
    float update(const int16_t *window, float gate, float dt = 1.0f / 30);

    // Renders the current waveform into the framebuffer; returns the rows that changed.
    Rows render();

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
    void write_span(int lo, int hi, int y0, int rows);

    int w_, h_, hw_, bands_;
    float r0_, amp_, cy_;
    uint8_t *intensity_, *colour_;
    uint16_t *fb_;
    std::vector<Span> prev_;
    uint16_t lut_[COLOURS][LEVELS] = {};
    uint8_t brush_[2 * BRUSH_R + 1][2 * BRUSH_R + 1] = {};
    float disp_[POINTS] = {};
    float window_[WINDOW] = {};
    Point pts_[POINTS] = {};
    float env_;
};

}  // namespace homunculus::ring
