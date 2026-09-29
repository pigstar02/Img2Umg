#include "Img2UmgEntryWidget.h"

#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Image.h"
#include "Components/TextBlock.h"
#include "Engine/Texture2D.h"
#include "Img2UmgItemData.h"

namespace
{
void ApplyResolvedField(UWidgetTree* Tree, const FImg2UmgFieldBinding& Binding, const FImg2UmgFieldValue& Value)
{
    if (!Tree)
    {
        return;
    }

    UWidget* Foreground = Binding.WidgetName.IsNone() ? nullptr : Tree->FindWidget(Binding.WidgetName);
    if (UTextBlock* Text = Cast<UTextBlock>(Foreground))
    {
        Text->SetText(Value.Text);
        Text->SetColorAndOpacity(FSlateColor(Value.Color));
    }
    else if (UImage* Image = Cast<UImage>(Foreground))
    {
        // Preserve importer-authored sizing/UV data. Null is an explicit clear, not a white rectangle.
        FSlateBrush Brush = Image->GetBrush();
        Brush.SetResourceObject(Value.Image.Get());
        Brush.DrawAs = Value.Image ? ESlateBrushDrawType::Image : ESlateBrushDrawType::NoDrawType;
        Image->SetBrush(Brush);
    }

    if (!Binding.BackgroundWidgetName.IsNone())
    {
        if (UBorder* Border = Cast<UBorder>(Tree->FindWidget(Binding.BackgroundWidgetName)))
        {
            Border->SetBrushColor(Value.Background);
        }
    }
}
}

void UImg2UmgEntryWidget::ApplyItem(UImg2UmgItemData* ItemData)
{
    // Resolve from the immutable serialized baseline on EVERY assignment. Never use previous widget
    // state as a fallback: sparse records and pooled entries must not leak another item's fields.
    for (const FImg2UmgFieldBinding& Binding : FieldBindings)
    {
        FImg2UmgFieldValue Value = Binding.Defaults;
        const FImg2UmgFieldValue* Override = ItemData ? ItemData->Item.Overrides.Find(Binding.NodeId) : nullptr;
        if (Override)
        {
            if (Override->bHasText) { Value.Text = Override->Text; }
            if (Override->bHasImage) { Value.Image = Override->Image; }
            if (Override->bHasBackground) { Value.Background = Override->Background; }
            if (Override->bHasColor) { Value.Color = Override->Color; }
        }
        ApplyResolvedField(WidgetTree, Binding, Value);
    }
}

void UImg2UmgEntryWidget::ResetFields()
{
    ApplyItem(nullptr);
}

void UImg2UmgEntryWidget::NativeOnListItemObjectSet(UObject* ListItemObject)
{
    ApplyItem(Cast<UImg2UmgItemData>(ListItemObject));
    IUserObjectListEntry::NativeOnListItemObjectSet(ListItemObject);
}

void UImg2UmgEntryWidget::NativeOnEntryReleased()
{
    ResetFields();
    IUserObjectListEntry::NativeOnEntryReleased();
}
