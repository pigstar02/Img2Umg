#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Img2UmgRuntimeTypes.h"
#include "Img2UmgItemData.generated.h"

/** Serializable typed data adapter for a real UListView item; no JSON or editor dependency. */
UCLASS(BlueprintType)
class IMG2UMGRUNTIME_API UImg2UmgItemData : public UObject
{
    GENERATED_BODY()
public:
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FImg2UmgItemRecord Item;
};
