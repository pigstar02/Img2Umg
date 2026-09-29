#include "Img2UmgScreenWidget.h"

#include "Blueprint/WidgetTree.h"
#include "Components/ListView.h"
#include "Img2UmgItemData.h"

void UImg2UmgScreenWidget::NativeOnInitialized()
{
    if (bPopulateSamplesOnInitialized && !IsDesignTime())
    {
        PopulateCollectionSamples();
    }
    // Blueprint OnInitialized may replace samples with business data after the baseline is ready.
    Super::NativeOnInitialized();
}

void UImg2UmgScreenWidget::PopulateCollectionSamples()
{
    if (IsDesignTime() || !WidgetTree)
    {
        return;
    }

    for (const FImg2UmgCollectionSample& Sample : CollectionSamples)
    {
        UListView* List = Cast<UListView>(WidgetTree->FindWidget(Sample.ListWidgetName));
        if (!List)
        {
            continue; // A user-edited blueprint may have removed a generated binding.
        }

        TArray<UObject*> Items;
        Items.Reserve(Sample.Items.Num());
        for (const FImg2UmgItemRecord& Record : Sample.Items)
        {
            UImg2UmgItemData* Data = NewObject<UImg2UmgItemData>(List);
            Data->Item = Record;
            Items.Add(Data);
        }
        // UListView keeps a reflected strong reference to every object. Empty arrays clear the list.
        List->SetListItems(Items);
    }
}
