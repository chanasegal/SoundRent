using System.Net;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using SoundRent.Api.Application.Exceptions;

namespace SoundRent.Api.Filters;

/// <summary>
/// Converts expected domain exceptions into HTTP responses inside MVC so the
/// exception is marked handled before it reaches the host — avoids debugger
/// "user-unhandled" breaks on ValidationException / NotFound / Unauthorized.
/// </summary>
public sealed class ApiExceptionFilter : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        if (context.ExceptionHandled)
        {
            return;
        }

        var (status, message) = context.Exception switch
        {
            ValidationException ex => (HttpStatusCode.BadRequest, ex.Message),
            NotFoundException ex => (HttpStatusCode.NotFound, ex.Message),
            UnauthorizedException ex => (HttpStatusCode.Unauthorized, ex.Message),
            _ => ((HttpStatusCode?)null, (string?)null)
        };

        if (status is null || message is null)
        {
            return;
        }

        context.Result = new ObjectResult(new
        {
            statusCode = (int)status.Value,
            message
        })
        {
            StatusCode = (int)status.Value
        };
        context.ExceptionHandled = true;
    }
}

/// <summary>
/// Async counterpart for action methods that return Task / ValueTask.
/// </summary>
public sealed class ApiExceptionFilterAsync : IAsyncExceptionFilter
{
    public Task OnExceptionAsync(ExceptionContext context)
    {
        new ApiExceptionFilter().OnException(context);
        return Task.CompletedTask;
    }
}
