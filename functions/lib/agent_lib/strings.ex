defmodule AgentLib.Strings do
  @moduledoc """
  Shared string helpers for registry tools. Not callable via `call-function`.
  """

  @spec blank?(String.t() | nil) :: boolean()
  def blank?(nil), do: true
  def blank?(str) when is_binary(str), do: String.trim(str) == ""
end
