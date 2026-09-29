#pragma once

#include "CoreMinimal.h"
#include "Components/ListView.h"
#include "Img2UmgListView.generated.h"

/** Editor importer configuration surface; all resulting properties serialize in the widget tree. */
UCLASS(BlueprintType)
class IMG2UMGRUNTIME_API UImg2UmgListView : public UListView
{
    GENERATED_BODY()
public:
    /** Call before the Slate list is constructed. Rejects invalid classes, spacing and live changes. */
    bool Configure(TSubclassOf<UUserWidget> InEntryClass, EOrientation InOrientation, float InSpacing);

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
};
