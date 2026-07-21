namespace SoundRent.Api.Application.DTOs;

public class BookDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Author { get; set; }
    public string? Category { get; set; }
    public int SortOrder { get; set; }
    public int TotalQuantity { get; set; }
    public List<string> Copies { get; set; } = new();
}

public class BookCreateDto
{
    public string Title { get; set; } = string.Empty;
    public string? Author { get; set; }
    public string? Category { get; set; }
    public int? Quantity { get; set; }
    public List<string>? Copies { get; set; }
}

public class BookUpdateDto
{
    public string Title { get; set; } = string.Empty;
    public string? Author { get; set; }
    public string? Category { get; set; }
}

public class BookCopiesUpdateDto
{
    public List<string> Copies { get; set; } = new();
}

public class BookTypeUpdateDto
{
    public int Id { get; set; }
    public List<string> Copies { get; set; } = new();
}

public class BookBatchUpdateDto
{
    public List<BookTypeUpdateDto> Items { get; set; } = new();
}

public class BookCopyLocationDto
{
    public string CopyNumber { get; set; } = string.Empty;
    public string BookTitle { get; set; } = string.Empty;
    public int? BookId { get; set; }
    public bool IsRegistered { get; set; }
    public bool IsInWarehouse { get; set; }
    public int? LoanId { get; set; }
    public string? ClientName { get; set; }
    public string? Phone { get; set; }
    public string? Phone2 { get; set; }
    public string? Address { get; set; }
    public string? Deposit { get; set; }
    public string? Notes { get; set; }

    /// <summary>Stored Hebrew lent display from the active loan (may include time).</summary>
    public string? HebrewLentDisplay { get; set; }

    /// <summary>Gregorian loan date (yyyy-MM-dd) for Hebrew calendar conversion.</summary>
    public DateOnly? LoanDate { get; set; }
}

/// <summary>Available (unborrowed) copies for one tool definition — bulk availability payload.</summary>
public class BookAvailableCopiesGroupDto
{
    public int BookId { get; set; }
    public List<string> Copies { get; set; } = new();
}

public class BookLoanItemDto
{
    public int Id { get; set; }
    public int BookId { get; set; }
    public string BookTitle { get; set; } = string.Empty;
    public string CopyNumber { get; set; } = string.Empty;
    public DateTime? ReturnedAt { get; set; }
    public string? HebrewReturnedDisplay { get; set; }
    public decimal? ChargeAmount { get; set; }
    public bool? ChargeIsPaid { get; set; }
    public int? CustomerDebtId { get; set; }
}

public class BookLoanDto
{
    public int Id { get; set; }
    public DateTime LentAt { get; set; }
    public string HebrewLentDisplay { get; set; } = string.Empty;
    public string ClientName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Phone2 { get; set; }
    public string? Address { get; set; }
    public string? Deposit { get; set; }
    public string? Notes { get; set; }
    public DateTime? DeadlineAt { get; set; }
    public DateTime? ReturnedAt { get; set; }
    public string? HebrewReturnedDisplay { get; set; }
    public List<BookLoanItemDto> Items { get; set; } = new();
}

public class BookLoanItemCreateDto
{
    public int BookId { get; set; }
    public string CopyNumber { get; set; } = string.Empty;
}

public class BookLoanCreateDto
{
    public string ClientName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Phone2 { get; set; }
    public string? Address { get; set; }
    public string? Deposit { get; set; }
    public string? Notes { get; set; }
    public string HebrewLentDisplay { get; set; } = string.Empty;
    public DateTime? DeadlineAt { get; set; }
    public List<BookLoanItemCreateDto> Items { get; set; } = new();
}

public class BookLoanReturnDto
{
    public string HebrewReturnedDisplay { get; set; } = string.Empty;
    public decimal? ChargeAmount { get; set; }
}

public class BookLoanReturnByCodeDto
{
    public int BookId { get; set; }
    public string CopyNumber { get; set; } = string.Empty;
    public string HebrewReturnedDisplay { get; set; } = string.Empty;
    public decimal? ChargeAmount { get; set; }
}

public class BookLoanUndoReturnDto
{
    public int ItemId { get; set; }
}

/// <summary>One completed return for a specific tool definition + serial code (audit history).</summary>
public class BookItemBorrowHistoryDto
{
    public int LoanId { get; set; }
    public int ItemId { get; set; }
    public int BookId { get; set; }
    public string BookTitle { get; set; } = string.Empty;
    public string CopyNumber { get; set; } = string.Empty;
    public string ClientName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public DateTime LentAt { get; set; }
    public string HebrewLentDisplay { get; set; } = string.Empty;
    public DateTime? DeadlineAt { get; set; }
    public DateTime ReturnedAt { get; set; }
    public string? HebrewReturnedDisplay { get; set; }
    public decimal? ChargeAmount { get; set; }
    public bool? ChargeIsPaid { get; set; }
    public int? CustomerDebtId { get; set; }
}
