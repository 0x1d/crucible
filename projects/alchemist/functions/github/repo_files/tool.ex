defmodule AgentFn.Github.RepoFiles do
  @moduledoc """
  List file paths (blobs) in a public GitHub repo via the git trees API.

  Args:
  - `repo` (required) — `owner/name`
  - `ref` — branch/sha (default `HEAD`)
  - `contains` — optional substring filter on path
  - `ext` — optional list of extensions (e.g. [".rs", ".md"])
  - `limit` — max paths returned (default 500)

  Returns `paths` (with `size`), `count`, `total`, `truncated`.
  """
  @behaviour AgentFn.Tool

  alias AgentFn.Http.Get
  @type args :: %{
    optional(:contains) => String.t(),
    optional(:ext) => [String.t()],
    optional(:limit) => non_neg_integer(),
    optional(:ref) => String.t(),
    required(:repo) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    repo = args["repo"]
    ref = args["ref"] || "HEAD"
    contains = args["contains"]
    exts = args["ext"] || []
    limit = args["limit"] || 500

    if not is_binary(repo) or not String.contains?(repo, "/") do
      {:error, "repo must be owner/name"}
    else
      url = "https://api.github.com/repos/#{repo}/git/trees/#{ref}?recursive=1"

      with {:ok, %{"status" => 200, "body" => body}} <-
             Get.run(%{
               "url" => url,
               "headers" => %{"User-Agent" => "alchemist", "Accept" => "application/vnd.github+json"},
               "timeout_ms" => 30_000
             }),
           {:ok, json} <- Jason.decode(body) do
        blobs =
          (json["tree"] || [])
          |> Enum.filter(&(&1["type"] == "blob"))
          |> Enum.filter(fn e ->
            (is_nil(contains) or String.contains?(e["path"], contains)) and
              (exts == [] or Enum.any?(exts, &String.ends_with?(e["path"], &1)))
          end)
          |> Enum.map(&%{"path" => &1["path"], "size" => &1["size"]})

        {:ok,
         %{
           "repo" => repo,
           "ref" => ref,
           "total" => length(blobs),
           "count" => min(length(blobs), limit),
           "paths" => Enum.take(blobs, limit),
           "truncated" => length(blobs) > limit or json["truncated"] == true
         }}
      else
        {:ok, %{"status" => s, "body" => b}} -> {:error, "GitHub status #{s}: #{String.slice(b, 0, 300)}"}
        {:error, e} when is_binary(e) -> {:error, e}
        {:error, e} -> {:error, inspect(e)}
      end
    end
  end
end