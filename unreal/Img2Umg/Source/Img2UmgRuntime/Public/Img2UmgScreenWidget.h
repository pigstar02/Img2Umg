#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Img2UmgRuntimeTypes.h"
#include "Img2UmgScreenWidget.generated.h"

/** Root class for generated V2 screen blueprints. Samples become actual list objects at runtime. */
UCLASS(BlueprintType, Blueprintable)
class IMG2UMGRUNTIME_API UImg2UmgScreenWidget : public UUserWidget
{
    GENERATED_BODY()
    friend class FImg2UmgScreenSamplesTest;
public:
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    TArray<FImg2UmgCollectionSample> CollectionSamples;

    /** Disable in production to provide business-owned list data instead. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    bool bPopulateSamplesOnInitialized = true;

    /** Explicit replacement operation. Never creates fake designer rows; safe to call repeatedly. */
    UFUNCTION(BlueprintCallable, Category = "Img2Umg")
    void PopulateCollectionSamples();

protected:
    virtual void NativeOnInitialized() override;
};
