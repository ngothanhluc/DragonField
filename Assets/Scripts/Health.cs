using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

public class Health : MonoBehaviour
{
    [SerializeField]
    private int currentHealth, maxHealth;

    public UnityEvent<GameObject> OnHitWithReference, OnDeathWithReference;

    [SerializeField]
    private bool isDead = false;
    [SerializeField]
    private HealthBar healthBar;

    public void InitializeHealth(int healthValue)
    {
        currentHealth = healthValue;
        maxHealth = healthValue;
        isDead = false;
        if (healthBar != null)
        {
            healthBar.setMaxHealth(maxHealth);
        }
    }
    public void AddHealth(int amount)
    {
        currentHealth += amount;
        if (currentHealth > maxHealth)
        {
            currentHealth = maxHealth;
        }
        if (healthBar != null)
        {
            healthBar.setHealth(currentHealth);
        }
    }
    public void GetHit(int amount, GameObject sender)
    {
        if (isDead)
            return;
        if (sender && sender.layer == gameObject.layer)
            return;

        currentHealth -= amount;
        if (healthBar != null)
            healthBar.setHealth(currentHealth);
        if (currentHealth > 0)
        {
            OnHitWithReference?.Invoke(sender);
        }
        else
        {
            OnDeathWithReference?.Invoke(sender);
            isDead = true;
            if (gameObject.CompareTag("Player"))
                gameObject.GetComponent<AgentAnimations>().PlayDeathAnimation();
            else
                Destroy(gameObject);
        }
    }
}