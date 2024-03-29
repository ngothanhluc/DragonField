using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Projectile : MonoBehaviour
{
    // Start is called before the first frame update
    public float speed;
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {
        transform.Translate(Vector2.right * speed * Time.deltaTime);
    }
    private void OnTriggerEnter2D(Collider2D other)
    {
        if (other)
        {
            Health health = other.GetComponent<Health>();
            if (health != null)
            {
                health.GetHit(1, transform.gameObject);
            }
            Destroy(gameObject);
        }
    }
}
