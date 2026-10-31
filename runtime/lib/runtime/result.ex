defmodule Runtime.Result do
  @moduledoc """
  Maps exceptions and thrown errors into codex JSON error maps (`%{ok: false, error: ...}`).

  Used at protocol boundaries (`Runtime.Server`, `Runtime.Engine`) so callers do not
  duplicate `try/rescue/catch` envelopes.
  """

  @spec wrap((-> term())) :: term()
  def wrap(fun) when is_function(fun, 0) do
    try do
      fun.()
    rescue
      exception -> %{ok: false, error: Exception.message(exception)}
    catch
      :throw, {:error, message} -> %{ok: false, error: message}
      :exit, reason -> %{ok: false, error: "exit: #{inspect(reason)}"}
    end
  end
end
