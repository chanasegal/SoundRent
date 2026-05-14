using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class LoanedEquipmentNoteConfiguration : IEntityTypeConfiguration<LoanedEquipmentNote>
{
    public void Configure(EntityTypeBuilder<LoanedEquipmentNote> builder)
    {
        builder.ToTable("LoanedEquipmentNotes");

        builder.HasKey(n => n.Id);

        builder.Property(n => n.Content).HasMaxLength(100);

        builder.HasIndex(n => new { n.OrderLoanedEquipmentId, n.Ordinal })
            .IsUnique()
            .HasDatabaseName("IX_LoanedEquipmentNotes_Line_Ordinal");

        builder.HasOne(n => n.OrderLoanedEquipment)
            .WithMany(le => le.Notes)
            .HasForeignKey(n => n.OrderLoanedEquipmentId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
