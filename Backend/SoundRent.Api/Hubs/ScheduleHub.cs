using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace SoundRent.Api.Hubs;

/// <summary>
/// Push channel for the weekly schedule board. Clients only listen; the server
/// broadcasts <see cref="ScheduleUpdatedMethod"/> after any schedule mutation.
/// </summary>
[Authorize]
public class ScheduleHub : Hub
{
    public const string Route = "/hubs/schedule";
    public const string ScheduleUpdatedMethod = "ScheduleUpdated";
}

/// <param name="Source">Which resource changed: "orders", "waitlist", or "blocked-dates".</param>
/// <param name="ChangeType">"created", "updated", or "deleted".</param>
/// <param name="EntityId">Id of the changed row when known from the route.</param>
public record ScheduleUpdatedEvent(string Source, string ChangeType, int? EntityId);
