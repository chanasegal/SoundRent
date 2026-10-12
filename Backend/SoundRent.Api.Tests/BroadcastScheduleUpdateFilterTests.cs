using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using SoundRent.Api.Filters;
using SoundRent.Api.Hubs;

namespace SoundRent.Api.Tests;

public class BroadcastScheduleUpdateFilterTests
{
    [Fact]
    public async Task Post201_BroadcastsCreated()
    {
        var hub = new RecordingHubContext();

        await RunAsync(hub, "POST", new CreatedResult("/api/orders/7", null));

        var sent = Assert.Single(hub.AllProxy.Sent);
        Assert.Equal(ScheduleHub.ScheduleUpdatedMethod, sent.Method);
        Assert.Equal(new ScheduleUpdatedEvent("orders", "created", null), Assert.Single(sent.Args));
    }

    [Fact]
    public async Task Put200_BroadcastsUpdatedWithRouteId()
    {
        var hub = new RecordingHubContext();

        await RunAsync(hub, "PUT", new OkObjectResult(new object()), routeId: "42");

        var sent = Assert.Single(hub.AllProxy.Sent);
        Assert.Equal(new ScheduleUpdatedEvent("orders", "updated", 42), Assert.Single(sent.Args));
    }

    [Fact]
    public async Task Delete204_BroadcastsDeleted()
    {
        var hub = new RecordingHubContext();

        await RunAsync(hub, "DELETE", new NoContentResult(), routeId: "9");

        var sent = Assert.Single(hub.AllProxy.Sent);
        Assert.Equal(new ScheduleUpdatedEvent("orders", "deleted", 9), Assert.Single(sent.Args));
    }

    [Fact]
    public async Task Get_DoesNotBroadcast()
    {
        var hub = new RecordingHubContext();

        await RunAsync(hub, "GET", new OkObjectResult(Array.Empty<object>()));

        Assert.Empty(hub.AllProxy.Sent);
    }

    [Fact]
    public async Task ValidationFailure_DoesNotBroadcast()
    {
        var hub = new RecordingHubContext();

        await RunAsync(hub, "PUT", new BadRequestObjectResult(new { message = "bad" }), routeId: "1");

        Assert.Empty(hub.AllProxy.Sent);
    }

    [Fact]
    public async Task UnhandledException_DoesNotBroadcast()
    {
        var hub = new RecordingHubContext();

        await RunAsync(hub, "DELETE", result: null, routeId: "1", exception: new InvalidOperationException());

        Assert.Empty(hub.AllProxy.Sent);
    }

    [Fact]
    public async Task HubFailure_DoesNotFailTheRequest()
    {
        var hub = new RecordingHubContext();
        hub.AllProxy.ThrowOnSend = true;

        var executed = await RunAsync(hub, "POST", new CreatedResult("/api/orders/7", null));

        Assert.IsType<CreatedResult>(executed.Result);
    }

    private static async Task<ActionExecutedContext> RunAsync(
        RecordingHubContext hub,
        string method,
        IActionResult? result,
        string? routeId = null,
        Exception? exception = null)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = method;
        var routeData = new RouteData();
        if (routeId is not null)
        {
            routeData.Values["id"] = routeId;
        }

        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executing = new ActionExecutingContext(
            actionContext,
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
        var executed = new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), new object())
        {
            Result = result,
            Exception = exception
        };

        var filter = new BroadcastScheduleUpdateFilter(
            "orders",
            hub,
            NullLogger<BroadcastScheduleUpdateFilter>.Instance);
        await filter.OnActionExecutionAsync(executing, () => Task.FromResult(executed));
        return executed;
    }

    private sealed class RecordingHubContext : IHubContext<ScheduleHub>
    {
        private readonly RecordingHubClients _clients = new();

        public RecordingClientProxy AllProxy => _clients.AllProxy;
        public IHubClients Clients => _clients;
        public IGroupManager Groups => throw new NotSupportedException();
    }

    private sealed class RecordingHubClients : IHubClients
    {
        public RecordingClientProxy AllProxy { get; } = new();

        public IClientProxy All => AllProxy;
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => throw new NotSupportedException();
        public IClientProxy Client(string connectionId) => throw new NotSupportedException();
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => throw new NotSupportedException();
        public IClientProxy Group(string groupName) => throw new NotSupportedException();
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) =>
            throw new NotSupportedException();
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => throw new NotSupportedException();
        public IClientProxy User(string userId) => throw new NotSupportedException();
        public IClientProxy Users(IReadOnlyList<string> userIds) => throw new NotSupportedException();
    }

    private sealed class RecordingClientProxy : IClientProxy
    {
        public List<(string Method, object?[] Args)> Sent { get; } = [];
        public bool ThrowOnSend { get; set; }

        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            if (ThrowOnSend)
            {
                throw new HubException("connection lost");
            }
            Sent.Add((method, args));
            return Task.CompletedTask;
        }
    }
}
