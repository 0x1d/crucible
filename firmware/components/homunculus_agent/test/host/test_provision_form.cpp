#include <cstdio>
#include "homunculus/provision_form.hpp"

static int g_failures = 0;
#define CHECK(c, msg) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, msg); g_failures++; } } while (0)
using namespace homunculus::provision;

int main()
{
    auto f = parse_form("ssid=My+Net%21&password=p%26ss%3Dw&server=ws%3A%2F%2F10.0.0.2%3A8443%2Fhdp&token=&x");
    CHECK(f["ssid"] == "My Net!" && f["password"] == "p&ss=w", "decode");
    CHECK(f["server"] == "ws://10.0.0.2:8443/hdp" && f["token"].empty() && f.count("x") == 1, "fields");
    CHECK(parse_form("a=%zz%4").at("a") == "%zz%4", "bad escapes kept");
    CHECK(parse_form("").empty(), "empty body");
    CHECK(html_escape("<a href=\"x\">&'") == "&lt;a href=&quot;x&quot;&gt;&amp;&#39;", "escape");

    CHECK(validate({"net", "password1", "", ""}).empty(), "valid");
    CHECK(validate({"net", "", "wss://h/hdp", "tok-1"}).empty(), "open network, wss");
    CHECK(!validate({"", "", "", ""}).empty(), "empty ssid");
    CHECK(!validate({std::string(33, 'a'), "", "", ""}).empty(), "long ssid");
    CHECK(!validate({"n", "short", "", ""}).empty(), "short password");
    CHECK(!validate({"n", "", "http://h", ""}).empty(), "bad scheme");
    CHECK(!validate({"n", "", "ws://", ""}).empty(), "no host");
    CHECK(!validate({"n", "", "", "a b"}).empty(), "token space");

    const auto p = page({"A<b>", "C"}, "ws://h/\"x", "bad <input>");
    CHECK(p.find("A&lt;b&gt;") != std::string::npos && p.find("ws://h/&quot;x") != std::string::npos, "page escapes");
    CHECK(p.find("bad &lt;input&gt;") != std::string::npos, "error escaped");
    std::printf("%d failures\n", g_failures);
    return g_failures ? 1 : 0;
}
