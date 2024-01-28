using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

public class Agent : MonoBehaviour
{
    private AgentAnimations agentAnimations;
    private AgentMover agentMover;

    private WeaponParent weaponParent;

    private Vector2 pointerInput, movementInput;

    public Vector2 PointerInput { get => pointerInput; set => pointerInput = value; }
    public Vector2 MovementInput { get => movementInput; set => movementInput = value; }

    [SerializeField]
    private int maxHealth = 2;
    public Health health;
    [SerializeField]
    private AudioSource attackSound;
    private void Start()
    {
        health = GetComponent<Health>();
        if (health) health.InitializeHealth(maxHealth);
    }

    private void Update()
    {
        // pointerInput = GetPointerInput();
        // movementInput = movement.action.ReadValue<Vector2>().normalized;

        agentMover.MovementInput = MovementInput;
        weaponParent.PointerPosition = PointerInput;
        AnimateCharacter();
    }

    public void PerformAttack()
    {
        weaponParent.Attack(attackSound);
    }
    public void PerformRangeAttack()
    {
        weaponParent.RangeAttack(attackSound);
    }

    private void Awake()
    {
        agentAnimations = GetComponentInChildren<AgentAnimations>();
        weaponParent = GetComponentInChildren<WeaponParent>();
        agentMover = GetComponent<AgentMover>();
    }

    private void AnimateCharacter()
    {
        Vector2 lookDirection = PointerInput - (Vector2)transform.position;
        agentAnimations.RotateToPointer(lookDirection);
        agentAnimations.PlayAnimation(MovementInput);
    }
}