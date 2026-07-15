using System.Diagnostics;

namespace SoundRent.Api.Application.Exceptions;

/// <summary>Authentication / authorization failure. Handled globally as HTTP 401.</summary>
[DebuggerNonUserCode]
[DebuggerStepThrough]
public sealed class UnauthorizedException : Exception
{
    public UnauthorizedException(string message) : base(message) { }
}
