using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

public class EnemyAI : MonoBehaviour
{
    public UnityEvent<Vector2> OnMovementInput, OnPointerInput;
    public UnityEvent OnAttack;
    [SerializeField]
    private Transform player;
    [SerializeField]
    private float chaseDistanceThreshold = 5f, attackDistanceThreshold = 1f;
    [SerializeField]
    private float attackDelay = 1f;
    private float passedTime = 0f;

    private void Update()
    {
        if (player == null) return;
        float distance = Vector2.Distance(transform.position, player.position);
        if (distance < chaseDistanceThreshold)
        {
            OnPointerInput?.Invoke(player.position);
            if (distance <= attackDistanceThreshold)
            {
                OnMovementInput?.Invoke(Vector2.zero);
                if (passedTime > attackDelay)
                {
                    passedTime = 0f;
                    OnAttack?.Invoke();
                }
            }
            else
            {
                Vector2 direction = player.position - transform.position;
                OnMovementInput?.Invoke(direction.normalized);
            }
        }
        if (passedTime < attackDelay)
        {
            passedTime += Time.deltaTime;
        }
    }

}
