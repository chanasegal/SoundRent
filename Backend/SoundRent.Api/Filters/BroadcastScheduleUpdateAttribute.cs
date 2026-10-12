using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.SignalR;
using SoundRent.Api.Hubs;

namespace SoundRent.Api.Filters;

/// <summary>
/// Broadcasts <see cref="ScheduleHub.ScheduleUpdatedMethod"/> to every connected client
/// after a successful (2xx) non-GET action, so open weekly boards refetch.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class BroadcastScheduleUpdateAttribute : Attribute, IFilterFactory
{
    public BroadcastScheduleUpdateAttribute(string source)
    {
        Source = source;
    }

    public string Source { get; }

    public bool IsReusable => true;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider) =>
        new BroadcastScheduleUpdateFilter(
            Source,
            serviceProvider.GetRequiredService<IHubContext<ScheduleHub>>(),
            serviceProvider.GetRequiredService<ILogger<BroadcastScheduleUpdateFilter>>());
}

public sealed class BroadcastScheduleUpdateFilter : IAsyncActionFilter
{
    private readonly string _source;
    private readonly IHubContext<ScheduleHub> _hub;
    private readonly ILogger<BroadcastScheduleUpdateFilter> _logger;

    public BroadcastScheduleUpdateFilter(
        string source,
        IHubContext<ScheduleHub> hub,
        ILogger<BroadcastScheduleUpdateFilter> logger)
    {
        _source = source;
        _hub = hub;
        _logger = logger;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var executed = await next();

        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        {
            return;
        }

        if (executed.Exception is not null && !executed.ExceptionHandled)
        {
            return;
        }

        var statusCode = (executed.Result as IStatusCodeActionResult)?.StatusCode
            ?? StatusCodes.Status200OK;
        if (statusCode is < 200 or >= 300)
        {
            return;
        }

        var changeType = HttpMethods.IsPost(method) && statusCode == StatusCodes.Status201Created
            ? "created"
            : HttpMethods.IsDelete(method) ? "deleted" : "updated";

        int? entityId = context.RouteData.Values.TryGetValue("id", out var rawId)
            && int.TryParse(rawId?.ToString(), out var parsedId)
            ? parsedId
            : null;

        try
        {
            // The mutation is already committed; a broadcast failure must not fail the request.
            await _hub.Clients.All.SendAsync(
                ScheduleHub.ScheduleUpdatedMethod,
                new ScheduleUpdatedEvent(_source, changeType, entityId),
                CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Failed to broadcast {Method} for {Source} ({ChangeType}, id {EntityId}).",
                ScheduleHub.ScheduleUpdatedMethod,
                _source,
                changeType,
                entityId);
        }
    }
}
