using System.Diagnostics;

namespace SoundRent.Api.Application.Exceptions;

/// <summary>
/// Expected business-rule / input failure. Handled globally as HTTP 400 —
/// not an application crash. Marked non-user-code so debuggers with
/// "Just My Code" do not treat it as a break-worthy failure.
/// </summary>
[DebuggerNonUserCode]
[DebuggerStepThrough]
public sealed class ValidationException : Exception
{
    public ValidationException(string message) : base(message) { }

    /// <summary>Always HTTP 400 when mapped by global exception handling.</summary>
    public int StatusCode => 400;
}
