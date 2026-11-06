defmodule AgentFn.Weather.Current do
  @moduledoc """
  Current weather for a place via Open-Meteo (geocode + forecast).

  Args:
  - `place` / `location` / `city` (required) — place name to look up
  - `country` — optional ISO country code filter (e.g. "CH")
  """
  @behaviour AgentFn.Tool

  alias AgentFn.Http.Get, as: HttpGet
  alias AgentFn.Json.Parse, as: JsonParse

  @wmo %{
    0 => "Clear sky",
    1 => "Mainly clear",
    2 => "Partly cloudy",
    3 => "Overcast",
    45 => "Fog",
    48 => "Depositing rime fog",
    51 => "Light drizzle",
    53 => "Moderate drizzle",
    55 => "Dense drizzle",
    61 => "Slight rain",
    63 => "Moderate rain",
    65 => "Heavy rain",
    71 => "Slight snow",
    73 => "Moderate snow",
    75 => "Heavy snow",
    80 => "Slight rain showers",
    81 => "Moderate rain showers",
    82 => "Violent rain showers",
    95 => "Thunderstorm",
    96 => "Thunderstorm with slight hail",
    99 => "Thunderstorm with heavy hail"
  }
  @type args :: %{
    optional(:city) => String.t(),
    optional(:country) => String.t(),
    optional(:location) => String.t(),
    optional(:place) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, place} <- place_name(args),
         {:ok, geo} <- geocode(place, args["country"] || args[:country]),
         {:ok, wx} <- forecast(geo) do
      {:ok,
       %{
         "place" => geo["name"],
         "country" => geo["country"],
         "admin1" => geo["admin1"],
         "latitude" => geo["latitude"],
         "longitude" => geo["longitude"],
         "timezone" => wx["timezone"],
         "temperature_c" => wx["temperature_c"],
         "feels_like_c" => wx["feels_like_c"],
         "humidity_percent" => wx["humidity_percent"],
         "wind_kmh" => wx["wind_kmh"],
         "weather_code" => wx["weather_code"],
         "conditions" => Map.get(@wmo, wx["weather_code"], "Unknown"),
         "observed_at" => wx["observed_at"],
         "summary" => summary(geo, wx)
       }}
    end
  end

  defp place_name(args) do
    case args["place"] || args[:place] || args["location"] || args[:location] ||
           args["city"] || args[:city] do
      name when is_binary(name) and byte_size(name) > 0 -> {:ok, String.trim(name)}
      _ -> {:error, "place (or location/city) is required"}
    end
  end

  defp geocode(place, country) do
    base = %{name: place, count: "1", language: "en", format: "json"}

    q =
      if is_binary(country) and country != "" do
        Map.put(base, :country_code, country)
      else
        base
      end

    url = "https://geocoding-api.open-meteo.com/v1/search?" <> URI.encode_query(q)

    with {:ok, resp} <- unwrap_http(HttpGet.run(%{"url" => url})),
         body when is_binary(body) <- Map.get(resp, "body") || Map.get(resp, :body),
         {:ok, parsed} <- unwrap_json(JsonParse.run(%{"text" => body})),
         data when is_map(data) <- json_value(parsed),
         [hit | _] <- List.wrap(Map.get(data, "results")) do
      {:ok, hit}
    else
      [] -> {:error, "no geocoding results for #{inspect(place)}"}
      nil -> {:error, "geocode missing body or data"}
      {:error, _} = err -> err
      other -> {:error, "geocode failed: #{inspect(other)}"}
    end
  end

  defp forecast(geo) do
    qs =
      URI.encode_query(%{
        latitude: to_string(geo["latitude"]),
        longitude: to_string(geo["longitude"]),
        current:
          "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
        timezone: "auto",
        wind_speed_unit: "kmh"
      })

    url = "https://api.open-meteo.com/v1/forecast?" <> qs

    with {:ok, resp} <- unwrap_http(HttpGet.run(%{"url" => url})),
         body when is_binary(body) <- Map.get(resp, "body") || Map.get(resp, :body),
         {:ok, parsed} <- unwrap_json(JsonParse.run(%{"text" => body})),
         data when is_map(data) <- json_value(parsed),
         cur when is_map(cur) <- Map.get(data, "current") do
      {:ok,
       %{
         "timezone" => data["timezone"],
         "temperature_c" => cur["temperature_2m"],
         "feels_like_c" => cur["apparent_temperature"],
         "humidity_percent" => cur["relative_humidity_2m"],
         "wind_kmh" => cur["wind_speed_10m"],
         "weather_code" => cur["weather_code"],
         "observed_at" => cur["time"]
       }}
    else
      nil -> {:error, "forecast missing body, data, or current"}
      {:error, _} = err -> err
      other -> {:error, "forecast failed: #{inspect(other)}"}
    end
  end

  defp json_value(parsed) when is_map(parsed) do
    Map.get(parsed, "value") || Map.get(parsed, :value) ||
      Map.get(parsed, "data") || Map.get(parsed, :data) || parsed
  end

  defp unwrap_http({:ok, map}) when is_map(map), do: {:ok, map}
  defp unwrap_http({:error, reason}), do: {:error, to_string(reason)}
  defp unwrap_http(other), do: {:error, "http.get unexpected: #{inspect(other)}"}

  defp unwrap_json({:ok, map}) when is_map(map), do: {:ok, map}
  defp unwrap_json({:error, reason}), do: {:error, to_string(reason)}
  defp unwrap_json(other), do: {:error, "json.parse unexpected: #{inspect(other)}"}

  defp summary(geo, wx) do
    conds = Map.get(@wmo, wx["weather_code"], "Unknown")

    where =
      [geo["name"], geo["admin1"], geo["country"]]
      |> Enum.reject(&is_nil/1)
      |> Enum.join(", ")

    "#{where}: #{conds}, #{wx["temperature_c"]}°C (feels like #{wx["feels_like_c"]}°C), " <>
      "humidity #{wx["humidity_percent"]}%, wind #{wx["wind_kmh"]} km/h"
  end
end