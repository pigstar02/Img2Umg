#include "Img2UmgListView.h"

#include "Img2UmgEntryWidget.h"

TSharedRef<SWidget> UImg2UmgListView::RebuildWidget()
{
    TSharedRef<SWidget> Result = Super::RebuildWidget();
    // UE 5.8's setter only affects an existing Slate table; it does not serialize a default.
    SetScrollbarVisibility(ESlateVisibility::Collapsed);
    SetIsGamepadScrollingEnabled(false);
    return Result;
}

bool UImg2UmgListView::Configure(TSubclassOf<UUserWidget> InEntryClass, EOrientation InOrientation, float InSpacing)
{
    if (GetCachedWidget().IsValid() || !InEntryClass
        || !InEntryClass->IsChildOf(UImg2UmgEntryWidget::StaticClass())
        || InEntryClass->HasAnyClassFlags(CLASS_Abstract)
        || (InOrientation != Orient_Horizontal && InOrientation != Orient_Vertical)
        || !FMath::IsFinite(InSpacing) || InSpacing < 0.f)
    {
        return false;
    }

    EntryWidgetClass = InEntryClass;
    Orientation = InOrientation;
    SelectionMode = ESelectionMode::None;
    bIsFocusable = false;
    ConsumeMouseWheel = EConsumeMouseWheel::Never;
    SetWheelScrollMultiplier(0.f);
    AllowOverscroll = false;
    SetIsPointerScrollingEnabled(false);
    SetIsTouchScrollingEnabled(false);
    SetIsGamepadScrollingEnabled(false);
    bEnableRightClickScrolling = false;
    SetHorizontalEntrySpacing(InOrientation == Orient_Horizontal ? InSpacing : 0.f);
    SetVerticalEntrySpacing(InOrientation == Orient_Vertical ? InSpacing : 0.f);
    // UE 5.8 ListView applies spacing before all but the first row (no trailing gap).
    return true;
}
