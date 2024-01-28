using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

public class AnimatorHelper : MonoBehaviour
{
    // Start is called before the first frame update
    public UnityEvent OnAnimationEventTriggered, OnAttackPerformed;
    public void TriggerEvent()
    {
        OnAnimationEventTriggered?.Invoke();
    }
    public void TriggerAttack()
    {
        OnAttackPerformed?.Invoke();
    }
}
