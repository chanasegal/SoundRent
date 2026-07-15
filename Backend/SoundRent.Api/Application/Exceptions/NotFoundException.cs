using System.Diagnostics;

namespace SoundRent.Api.Application.Exceptions;

/// <summary>Resource missing. Handled globally as HTTP 404.</summary>
[DebuggerNonUserCode]
[DebuggerStepThrough]
public sealed class NotFoundException : Exception
{
    public NotFoundException(string message) : base(message) { }
}
