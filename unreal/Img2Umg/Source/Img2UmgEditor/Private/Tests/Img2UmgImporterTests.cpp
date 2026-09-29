#if WITH_DEV_AUTOMATION_TESTS

#include "Misc/AutomationTest.h"

#include "Blueprint/IUserObjectListEntry.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/ListView.h"
#include "Components/TileView.h"
#include "Components/Widget.h"
#include "Img2UmgImporter.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "WidgetBlueprint.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FImg2UmgImportInventoryTest,
    "Img2Umg.Import.Inventory",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FImg2UmgImportInventoryTest::RunTest(const FString& Parameters)
{
    FString ManifestPath;
    if (!FParse::Value(FCommandLine::Get(), TEXT("Img2UmgManifest="), ManifestPath) || ManifestPath.IsEmpty())
    {
        AddError(TEXT("Pass -Img2UmgManifest=<absolute ui.manifest.json path> to run this test."));
        return false;
    }

    FImg2UmgImporter Importer;
    FText ImportError;
    if (!TestTrue(TEXT("The inventory JSON package imports successfully"), Importer.ImportManifest(ManifestPath, ImportError)))
    {
        AddError(ImportError.ToString());
        return false;
    }

    UWidgetBlueprint* Screen = LoadObject<UWidgetBlueprint>(nullptr, TEXT("/Game/Img2Umg/WBP_Inventory.WBP_Inventory"));
    UWidgetBlueprint* QuestEntry = LoadObject<UWidgetBlueprint>(nullptr, TEXT("/Game/Img2Umg/WBP_Quest_ListItem.WBP_Quest_ListItem"));
    UWidgetBlueprint* TileEntry = LoadObject<UWidgetBlueprint>(nullptr, TEXT("/Game/Img2Umg/WBP_Inventory_TileItem.WBP_Inventory_TileItem"));

    if (!TestNotNull(TEXT("The screen Widget Blueprint was generated"), Screen)
        || !TestNotNull(TEXT("The ListView item Widget Blueprint was generated"), QuestEntry)
        || !TestNotNull(TEXT("The TileView item Widget Blueprint was generated"), TileEntry))
    {
        return false;
    }

    TestTrue(TEXT("The screen root is a Canvas Panel"), Screen->WidgetTree->RootWidget->IsA<UCanvasPanel>());
    UListView* QuestList = Cast<UListView>(Screen->WidgetTree->FindWidget(TEXT("QuestList")));
    UTileView* ItemTiles = Cast<UTileView>(Screen->WidgetTree->FindWidget(TEXT("ItemTiles")));
    UWidget* Backdrop = Screen->WidgetTree->FindWidget(TEXT("Backdrop"));
    TestNotNull(TEXT("QuestList was converted to a ListView"), QuestList);
    TestNotNull(TEXT("ItemTiles was converted to a TileView"), ItemTiles);
    TestNotNull(TEXT("Backdrop was generated"), Backdrop);
    if (QuestList) TestTrue(TEXT("QuestList is exported as a Blueprint variable"), QuestList->bIsVariable);
    if (ItemTiles) TestTrue(TEXT("ItemTiles is exported as a Blueprint variable"), ItemTiles->bIsVariable);
    if (Backdrop) TestFalse(TEXT("Static backdrop is not exported as a Blueprint variable"), Backdrop->bIsVariable);

    TestTrue(TEXT("The ListView item implements IUserObjectListEntry"), QuestEntry->GeneratedClass->ImplementsInterface(UUserObjectListEntry::StaticClass()));
    TestTrue(TEXT("The TileView item implements IUserObjectListEntry"), TileEntry->GeneratedClass->ImplementsInterface(UUserObjectListEntry::StaticClass()));

    const FObjectPropertyBase* EntryClassProperty = FindFProperty<FObjectPropertyBase>(UListViewBase::StaticClass(), TEXT("EntryWidgetClass"));
    const FIntProperty* PreviewCountProperty = FindFProperty<FIntProperty>(UListViewBase::StaticClass(), TEXT("NumDesignerPreviewEntries"));
    const FFloatProperty* HorizontalSpacingProperty = FindFProperty<FFloatProperty>(UListView::StaticClass(), TEXT("HorizontalEntrySpacing"));
    const FFloatProperty* VerticalSpacingProperty = FindFProperty<FFloatProperty>(UListView::StaticClass(), TEXT("VerticalEntrySpacing"));
    if (!TestNotNull(TEXT("UE exposes EntryWidgetClass"), EntryClassProperty)
        || !TestNotNull(TEXT("UE exposes NumDesignerPreviewEntries"), PreviewCountProperty)
        || !TestNotNull(TEXT("UE exposes HorizontalEntrySpacing"), HorizontalSpacingProperty)
        || !TestNotNull(TEXT("UE exposes VerticalEntrySpacing"), VerticalSpacingProperty)
        || !QuestList
        || !ItemTiles)
    {
        return false;
    }

    TestTrue(TEXT("ListView references its generated item Blueprint"),
        Cast<UClass>(EntryClassProperty->GetObjectPropertyValue_InContainer(QuestList)) == QuestEntry->GeneratedClass);
    TestTrue(TEXT("TileView references its generated item Blueprint"),
        Cast<UClass>(EntryClassProperty->GetObjectPropertyValue_InContainer(ItemTiles)) == TileEntry->GeneratedClass);
    TestEqual(TEXT("ListView carries three preview items"), PreviewCountProperty->GetPropertyValue_InContainer(QuestList), 3);
    TestEqual(TEXT("TileView carries seven preview items"), PreviewCountProperty->GetPropertyValue_InContainer(ItemTiles), 7);
    TestEqual(TEXT("ListView horizontal spacing was imported"), HorizontalSpacingProperty->GetPropertyValue_InContainer(QuestList), 0.0f);
    TestEqual(TEXT("ListView vertical spacing was imported"), VerticalSpacingProperty->GetPropertyValue_InContainer(QuestList), 12.0f);
    TestEqual(TEXT("TileView horizontal spacing was imported"), HorizontalSpacingProperty->GetPropertyValue_InContainer(ItemTiles), 16.0f);
    TestEqual(TEXT("TileView vertical spacing was imported"), VerticalSpacingProperty->GetPropertyValue_InContainer(ItemTiles), 16.0f);
    return true;
}

#endif
