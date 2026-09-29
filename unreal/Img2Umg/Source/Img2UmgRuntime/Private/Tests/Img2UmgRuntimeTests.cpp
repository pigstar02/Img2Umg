#if WITH_DEV_AUTOMATION_TESTS

#include "Misc/AutomationTest.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/Image.h"
#include "Components/TextBlock.h"
#include "Engine/Texture2D.h"
#include "Img2UmgEntryWidget.h"
#include "Img2UmgItemData.h"
#include "Img2UmgListView.h"
#include "Img2UmgScreenWidget.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FImg2UmgEntryReuseTest, "Img2Umg.V2.Runtime.EntryReuse",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FImg2UmgEntryReuseTest::RunTest(const FString& Parameters)
{
    UImg2UmgEntryWidget* Entry = NewObject<UImg2UmgEntryWidget>();
    Entry->WidgetTree = NewObject<UWidgetTree>(Entry);
    UCanvasPanel* Root = Entry->WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("Root"));
    Entry->WidgetTree->RootWidget = Root;
    UTextBlock* Text = Entry->WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("Label"));
    UImage* Image = Entry->WidgetTree->ConstructWidget<UImage>(UImage::StaticClass(), TEXT("Picture"));
    UBorder* Background = Entry->WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Background"));
    Root->AddChild(Text);
    Root->AddChild(Image);
    Root->AddChild(Background);
    UTexture2D* DefaultTexture = NewObject<UTexture2D>();
    UTexture2D* OverrideTexture = NewObject<UTexture2D>();

    FImg2UmgFieldBinding Label;
    Label.NodeId = TEXT("label-node");
    Label.WidgetName = TEXT("Label");
    Label.BackgroundWidgetName = TEXT("Background");
    Label.Defaults.Text = FText::FromString(TEXT("Default"));
    Label.Defaults.Color = FLinearColor::White;
    Label.Defaults.Background = FLinearColor::Blue;
    FImg2UmgFieldBinding Picture;
    Picture.NodeId = TEXT("image-node");
    Picture.WidgetName = TEXT("Picture");
    Picture.Defaults.Image = DefaultTexture;
    Entry->FieldBindings = {Label, Picture};

    UImg2UmgItemData* Full = NewObject<UImg2UmgItemData>();
    FImg2UmgFieldValue& TextOverride = Full->Item.Overrides.Add(Label.NodeId);
    TextOverride.bHasText = TextOverride.bHasColor = TextOverride.bHasBackground = true;
    TextOverride.Text = FText::FromString(TEXT("Changed"));
    TextOverride.Color = FLinearColor::Red;
    TextOverride.Background = FLinearColor::Green;
    FImg2UmgFieldValue& ImageOverride = Full->Item.Overrides.Add(Picture.NodeId);
    ImageOverride.bHasImage = true;
    ImageOverride.Image = OverrideTexture;
    Entry->NativeOnListItemObjectSet(Full);
    TestEqual(TEXT("Text assigned"), Text->GetText().ToString(), FString(TEXT("Changed")));
    TestEqual(TEXT("Color assigned"), Text->GetColorAndOpacity().GetSpecifiedColor(), FLinearColor::Red);
    TestEqual(TEXT("Background assigned"), Background->GetBrushColor(), FLinearColor::Green);
    TestTrue(TEXT("Image assigned"), Image->GetBrush().GetResourceObject() == OverrideTexture);

    UImg2UmgItemData* Sparse = NewObject<UImg2UmgItemData>();
    FImg2UmgFieldValue& EmptyText = Sparse->Item.Overrides.Add(Label.NodeId);
    EmptyText.bHasText = true;
    Entry->NativeOnListItemObjectSet(Sparse);
    TestTrue(TEXT("Explicit empty text clears previous text"), Text->GetText().IsEmpty());
    TestEqual(TEXT("Missing color restores baseline"), Text->GetColorAndOpacity().GetSpecifiedColor(), FLinearColor::White);
    TestEqual(TEXT("Missing background restores baseline"), Background->GetBrushColor(), FLinearColor::Blue);
    TestTrue(TEXT("Missing image restores baseline"), Image->GetBrush().GetResourceObject() == DefaultTexture);

    Sparse->Item.Overrides.Add(Picture.NodeId).bHasImage = true;
    Entry->ApplyItem(Sparse);
    TestNull(TEXT("Explicit null image clears resource"), Image->GetBrush().GetResourceObject());
    TestTrue(TEXT("Null image does not paint a white rectangle"), Image->GetBrush().DrawAs == ESlateBrushDrawType::NoDrawType);
    Entry->NativeOnEntryReleased();
    TestEqual(TEXT("Release resets text"), Text->GetText().ToString(), FString(TEXT("Default")));
    TestTrue(TEXT("Release resets image"), Image->GetBrush().GetResourceObject() == DefaultTexture);
    Entry->NativeOnListItemObjectSet(Full);
    Entry->NativeOnListItemObjectSet(NewObject<UObject>());
    TestEqual(TEXT("Foreign item resets text"), Text->GetText().ToString(), FString(TEXT("Default")));
    TestEqual(TEXT("Foreign item resets color"), Text->GetColorAndOpacity().GetSpecifiedColor(), FLinearColor::White);
    TestEqual(TEXT("Foreign item resets background"), Background->GetBrushColor(), FLinearColor::Blue);
    TestTrue(TEXT("Foreign item resets image"), Image->GetBrush().GetResourceObject() == DefaultTexture);
    TestTrue(TEXT("Native class implements list interface"), Entry->GetClass()->ImplementsInterface(UUserObjectListEntry::StaticClass()));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FImg2UmgScreenSamplesTest, "Img2Umg.V2.Runtime.ScreenSamples",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FImg2UmgScreenSamplesTest::RunTest(const FString& Parameters)
{
    UImg2UmgScreenWidget* Screen = NewObject<UImg2UmgScreenWidget>();
    Screen->WidgetTree = NewObject<UWidgetTree>(Screen);
    UImg2UmgListView* List = Screen->WidgetTree->ConstructWidget<UImg2UmgListView>(UImg2UmgListView::StaticClass(), TEXT("List"));
    Screen->WidgetTree->RootWidget = List;
    TestTrue(TEXT("Valid preconstruction configuration"), List->Configure(UImg2UmgEntryWidget::StaticClass(), Orient_Horizontal, 7.f));
    TestEqual(TEXT("Horizontal spacing"), List->GetHorizontalEntrySpacing(), 7.f);
    TestEqual(TEXT("Vertical spacing cleared"), List->GetVerticalEntrySpacing(), 0.f);
    TestFalse(TEXT("Unadapted entry rejected"), List->Configure(UUserWidget::StaticClass(), Orient_Vertical, 0.f));
    TestFalse(TEXT("Negative spacing rejected"), List->Configure(UImg2UmgEntryWidget::StaticClass(), Orient_Vertical, -1.f));
    TestTrue(TEXT("No scrollbar occupies collection geometry"), List->GetScrollbarVisibility() == ESlateVisibility::Collapsed);

    FImg2UmgCollectionSample Sample;
    Sample.ListWidgetName = TEXT("List");
    FImg2UmgItemRecord First;
    First.Key = TEXT("first");
    First.Overrides.Add(TEXT("label")).Text = FText::FromString(TEXT("Persisted sample"));
    First.Overrides[TEXT("label")].bHasText = true;
    FImg2UmgItemRecord Second;
    Second.Key = TEXT("second");
    Sample.Items = {First, Second};
    Screen->CollectionSamples.Add(Sample);
    // Exercise the native initialization callback with a real widget tree, not designer dummy rows.
    Screen->NativeOnInitialized();
    TestEqual(TEXT("Initialization creates actual items"), List->GetListItems().Num(), 2);
    if (List->GetListItems().Num() != 2) { return false; }
    UImg2UmgItemData* Item = Cast<UImg2UmgItemData>(List->GetListItems()[0]);
    if (!TestNotNull(TEXT("Real typed UObject item"), Item)) { return false; }
    TestEqual(TEXT("Sample key"), Item->Item.Key, First.Key);
    TestEqual(TEXT("Sample override copied"), Item->Item.Overrides[TEXT("label")].Text.ToString(), FString(TEXT("Persisted sample")));
    TestTrue(TEXT("Items owned by list"), Item->GetOuter() == List);
    Screen->PopulateCollectionSamples();
    TestEqual(TEXT("Repopulation replaces rather than appends"), List->GetListItems().Num(), 2);
    Screen->CollectionSamples[0].Items.Reset();
    Screen->bPopulateSamplesOnInitialized = false;
    Screen->NativeOnInitialized();
    TestEqual(TEXT("Opt-out preserves business data"), List->GetListItems().Num(), 2);
    Screen->PopulateCollectionSamples();
    TestEqual(TEXT("Explicit empty samples clear items"), List->GetListItems().Num(), 0);
    return true;
}

#endif
