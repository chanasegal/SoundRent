namespace SoundRent.Api.Application.DTOs;

public class GeneralMemoDto
{
    public string Content { get; set; } = string.Empty;

    public DateTime UpdatedAt { get; set; }
}

public class GeneralMemoUpdateDto
{
    public string? Content { get; set; }
}
