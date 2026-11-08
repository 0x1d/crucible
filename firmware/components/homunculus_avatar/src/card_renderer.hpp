// Full-screen cards (spec 06 §6.6): confirmation and text, rasterised into the panel
// framebuffer (byte-swapped RGB565). Platform independent, host-testable.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace homunculus::card {

constexpr int GLYPH_W = 8;
constexpr int GLYPH_H = 16;

// Word wrap to at most `max_lines` lines of `max_cols` columns; the last line ends with "..."
// when text is dropped. Control characters become spaces, non-ASCII becomes '?'.
std::vector<std::string> wrap(const std::string &text, int max_cols, int max_lines);

// Confirmation card: title, detail, deny (left, red) and approve (right, green) buttons in the
// lower half. Clears the framebuffer first.
void draw_confirm(uint16_t *fb, int w, int h, const std::string &title, const std::string &detail);

// Centred text card without buttons. Clears the framebuffer first.
void draw_text(uint16_t *fb, int w, int h, const std::string &text);

}  // namespace homunculus::card
