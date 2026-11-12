defmodule Runtime.ServiceGateway.Schema do
  @moduledoc """
  JSON Schema validation for service input and output.

  Covers the keywords services use: `type` (one or a list), `enum`, `const`,
  `properties`, `required`, `additionalProperties` (boolean or schema),
  `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`,
  `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `pattern`, `anyOf`,
  `oneOf`, and `allOf`. Other keywords are ignored.

  Values are decoded JSON: maps with string keys, lists, binaries, numbers,
  booleans, and `nil`.
  """

  @type error :: String.t()

  @doc "Validate `value` against `schema`. Returns `:ok` or `{:error, [path: message]}`."
  @spec validate(term(), map() | boolean()) :: :ok | {:error, [error()]}
  def validate(value, schema) do
    case errors(value, schema, "$") do
      [] -> :ok
      list -> {:error, list}
    end
  end

  defp errors(_value, true, _path), do: []
  defp errors(_value, false, path), do: ["#{path}: no value is allowed"]
  defp errors(_value, schema, _path) when schema == %{}, do: []

  defp errors(value, schema, path) when is_map(schema) do
    [
      &type_errors/3,
      &enum_errors/3,
      &const_errors/3,
      &object_errors/3,
      &array_errors/3,
      &string_errors/3,
      &number_errors/3,
      &combinator_errors/3
    ]
    |> Enum.flat_map(& &1.(value, schema, path))
  end

  defp errors(_value, _schema, path), do: ["#{path}: schema must be an object or boolean"]

  defp type_errors(value, %{"type" => types}, path) do
    types = List.wrap(types)

    if Enum.any?(types, &type?(value, &1)) do
      []
    else
      ["#{path}: expected #{Enum.join(types, " or ")}, got #{type_name(value)}"]
    end
  end

  defp type_errors(_, _, _), do: []

  defp enum_errors(value, %{"enum" => options}, path) when is_list(options) do
    if Enum.any?(options, &same?(&1, value)),
      do: [],
      else: ["#{path}: must be one of #{inspect(options)}"]
  end

  defp enum_errors(_, _, _), do: []

  defp const_errors(value, %{"const" => expected}, path) do
    if same?(expected, value), do: [], else: ["#{path}: must equal #{inspect(expected)}"]
  end

  defp const_errors(_, _, _), do: []

  defp object_errors(value, schema, path) when is_map(value) do
    props = Map.get(schema, "properties", %{})

    missing =
      schema
      |> Map.get("required", [])
      |> Enum.reject(&Map.has_key?(value, &1))
      |> Enum.map(&"#{path}.#{&1}: is required")

    nested =
      Enum.flat_map(value, fn {key, item} ->
        case Map.fetch(props, key) do
          {:ok, sub} ->
            errors(item, sub, "#{path}.#{key}")

          :error ->
            case Map.get(schema, "additionalProperties", true) do
              false -> ["#{path}.#{key}: is not allowed"]
              extra -> errors(item, extra, "#{path}.#{key}")
            end
        end
      end)

    missing ++ nested
  end

  defp object_errors(_, _, _), do: []

  defp array_errors(value, schema, path) when is_list(value) do
    count = length(value)

    bounds =
      bound(count, schema["minItems"], &>=/2, "#{path}: needs at least #{schema["minItems"]} items") ++
        bound(count, schema["maxItems"], &<=/2, "#{path}: allows at most #{schema["maxItems"]} items")

    items =
      case schema["items"] do
        nil ->
          []

        sub ->
          value
          |> Enum.with_index()
          |> Enum.flat_map(fn {item, i} -> errors(item, sub, "#{path}[#{i}]") end)
      end

    bounds ++ items
  end

  defp array_errors(_, _, _), do: []

  defp string_errors(value, schema, path) when is_binary(value) do
    length = String.length(value)

    bound(length, schema["minLength"], &>=/2, "#{path}: needs at least #{schema["minLength"]} characters") ++
      bound(length, schema["maxLength"], &<=/2, "#{path}: allows at most #{schema["maxLength"]} characters") ++
      pattern_errors(value, schema["pattern"], path)
  end

  defp string_errors(_, _, _), do: []

  defp pattern_errors(_value, nil, _path), do: []

  defp pattern_errors(value, pattern, path) when is_binary(pattern) do
    case Regex.compile(pattern, "u") do
      {:ok, regex} ->
        if Regex.match?(regex, value), do: [], else: ["#{path}: must match #{pattern}"]

      {:error, _} ->
        ["#{path}: schema pattern #{inspect(pattern)} does not compile"]
    end
  end

  defp number_errors(value, schema, path) when is_number(value) do
    bound(value, schema["minimum"], &>=/2, "#{path}: must be >= #{schema["minimum"]}") ++
      bound(value, schema["maximum"], &<=/2, "#{path}: must be <= #{schema["maximum"]}") ++
      bound(value, schema["exclusiveMinimum"], &>/2, "#{path}: must be > #{schema["exclusiveMinimum"]}") ++
      bound(value, schema["exclusiveMaximum"], &</2, "#{path}: must be < #{schema["exclusiveMaximum"]}")
  end

  defp number_errors(_, _, _), do: []

  defp combinator_errors(value, schema, path) do
    all =
      schema
      |> Map.get("allOf", [])
      |> Enum.flat_map(&errors(value, &1, path))

    any =
      case schema["anyOf"] do
        nil ->
          []

        options ->
          if Enum.any?(options, &(errors(value, &1, path) == [])),
            do: [],
            else: ["#{path}: matches none of anyOf"]
      end

    one =
      case schema["oneOf"] do
        nil ->
          []

        options ->
          case Enum.count(options, &(errors(value, &1, path) == [])) do
            1 -> []
            n -> ["#{path}: must match exactly one of oneOf (matched #{n})"]
          end
      end

    all ++ any ++ one
  end

  defp bound(_value, nil, _cmp, _message), do: []
  defp bound(value, limit, cmp, message) when is_number(limit),
    do: if(cmp.(value, limit), do: [], else: [message])

  defp bound(_value, _limit, _cmp, _message), do: []

  defp type?(value, "object"), do: is_map(value)
  defp type?(value, "array"), do: is_list(value)
  defp type?(value, "string"), do: is_binary(value)
  defp type?(value, "boolean"), do: is_boolean(value)
  defp type?(value, "null"), do: is_nil(value)
  defp type?(value, "number"), do: is_number(value)
  defp type?(value, "integer") when is_integer(value), do: true
  defp type?(value, "integer") when is_float(value), do: Float.round(value) == value
  defp type?(_value, _type), do: false

  defp type_name(value) when is_map(value), do: "object"
  defp type_name(value) when is_list(value), do: "array"
  defp type_name(value) when is_binary(value), do: "string"
  defp type_name(value) when is_boolean(value), do: "boolean"
  defp type_name(nil), do: "null"
  defp type_name(value) when is_integer(value), do: "integer"
  defp type_name(value) when is_float(value), do: "number"
  defp type_name(_value), do: "unknown"

  # JSON equality: 1 and 1.0 are the same number.
  defp same?(a, b) when is_number(a) and is_number(b), do: a == b
  defp same?(a, b), do: a === b
end
